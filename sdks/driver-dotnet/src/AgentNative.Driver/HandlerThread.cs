using System.Collections.Concurrent;

namespace AgentNative.Driver;

/// <summary>
/// One dedicated thread that runs every handler, for equipment libraries that must be called from
/// the thread that created them. On Windows it is a single-threaded COM apartment (STA), which a
/// vendor's COM automation object usually requires. Continuations of async handlers come back to
/// this thread too.
///
/// The thread waits for work with a managed wait, and the runtime pumps COM messages during
/// managed waits on an STA thread, so calls and events marshalled from other apartments are
/// dispatched. A control that needs a full Win32 message loop (a visible ActiveX control) needs
/// its own window thread; this is not one.
/// </summary>
public sealed class HandlerThread : IDisposable
{
    private readonly BlockingCollection<(SendOrPostCallback, object?)> _queue = new();
    private readonly Thread _thread;

    public HandlerThread(string name = "driver handlers")
    {
        _thread = new Thread(Loop) { Name = name, IsBackground = true };
        // Apartments exist only on Windows; elsewhere this is a plain dedicated thread.
        if (OperatingSystem.IsWindows()) _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
    }

    /// <summary>The thread's apartment: STA on Windows, Unknown elsewhere.</summary>
    public ApartmentState Apartment => OperatingSystem.IsWindows() ? ApartmentState.STA : ApartmentState.Unknown;

    /// <summary>Whether the calling code runs on this thread.</summary>
    public bool IsCurrent => Thread.CurrentThread == _thread;

    /// <summary>Run <paramref name="work"/> on the thread; its awaits resume there as well.</summary>
    public Task<T> Run<T>(Func<Task<T>> work)
    {
        var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        _queue.Add((async _ =>
        {
            try
            {
                completion.SetResult(await work());
            }
            catch (OperationCanceledException cancelled)
            {
                completion.SetCanceled(cancelled.CancellationToken);
            }
            catch (Exception error)
            {
                completion.SetException(error);
            }
        }, null));
        return completion.Task;
    }

    public void Dispose()
    {
        _queue.CompleteAdding();
        if (!IsCurrent) _thread.Join(TimeSpan.FromSeconds(5));
    }

    private void Loop()
    {
        SynchronizationContext.SetSynchronizationContext(new Context(this));
        foreach (var (callback, state) in _queue.GetConsumingEnumerable()) callback(state);
    }

    private sealed class Context(HandlerThread owner) : SynchronizationContext
    {
        public override void Post(SendOrPostCallback callback, object? state)
        {
            if (!owner._queue.IsAddingCompleted) owner._queue.Add((callback, state));
        }

        public override void Send(SendOrPostCallback callback, object? state)
        {
            if (owner.IsCurrent) callback(state);
            else owner.Run<object?>(() => { callback(state); return Task.FromResult<object?>(null); }).Wait();
        }

        public override SynchronizationContext CreateCopy() => this;
    }
}

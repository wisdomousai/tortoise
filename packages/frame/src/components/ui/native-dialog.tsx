import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Modal built on the native <dialog> element. The browser provides focus trapping, Escape and an
 * inert background without injecting <style> tags, which the local instance's CSP forbids
 * (Radix Dialog's scroll lock injects one). Content mounts only while open.
 */
function NativeDialog({
  open,
  onOpenChange,
  label,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      data-slot="native-dialog"
      onClose={() => onOpenChange(false)}
      onClick={(event) => event.target === event.currentTarget && onOpenChange(false)}
      className={cn(
        'm-auto max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl bg-popover p-0 text-popover-foreground shadow-lg ring-1 ring-foreground/10 backdrop:bg-black/40',
        className,
      )}
    >
      {open && children}
    </dialog>
  );
}

export { NativeDialog };

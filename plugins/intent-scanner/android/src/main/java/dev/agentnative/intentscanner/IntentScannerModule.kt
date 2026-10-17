package dev.agentnative.intentscanner

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Receives the broadcast intents a rugged device's scanner app sends per scan and emits each as an
 * `onScan` event with the action and the data string. One receiver per action; listening twice to
 * the same action is a no-op. The receiver is exported because the scanner app is another
 * process; a sender permission, when given, restricts which apps can deliver scans.
 */
class IntentScannerModule : Module() {
  private val receivers = mutableMapOf<String, BroadcastReceiver>()

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AgentNativeIntentScanner")

    Events("onScan")

    Function("listen") { action: String, dataExtra: String, senderPermission: String? ->
      if (receivers.containsKey(action)) return@Function
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(received: Context, intent: Intent) {
          if (intent.action != action) return
          val text = intent.getStringExtra(dataExtra) ?: return
          sendEvent("onScan", Bundle().apply {
            putString("action", action)
            putString("text", text)
          })
        }
      }
      ContextCompat.registerReceiver(
        context,
        receiver,
        IntentFilter(action),
        senderPermission,
        null,
        ContextCompat.RECEIVER_EXPORTED,
      )
      receivers[action] = receiver
    }

    Function("stop") { action: String ->
      receivers.remove(action)?.let { context.unregisterReceiver(it) }
    }

    OnDestroy {
      val reactContext = appContext.reactContext
      for (receiver in receivers.values) runCatching { reactContext?.unregisterReceiver(receiver) }
      receivers.clear()
    }
  }
}

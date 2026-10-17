package dev.agentnative.osintents

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Carries activity intents between the OS and the mobile shell under the name the framework
 * gives this module, `AgentNativeOsIntents`.
 *
 * In: `listen` names the declared intent actions and, per action, the extras its handler
 * declares with their types. An intent with one of those actions, the launching one once and
 * each later one through `onIntent`, is passed on as its action, categories, data string, MIME
 * type and only the declared extras, read with typed getters. Every other intent and extra is
 * ignored here, and the mobile shell checks what is passed on again before submitting it.
 *
 * Out: `start` starts an activity in the named package only, with flat string, number and
 * boolean extras, so no other app that declares the same action receives them.
 */
class OsIntentsModule : Module() {
  private var listening: Map<String, Map<String, String>> = emptyMap()

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AgentNativeOsIntents")

    Events("onIntent")

    Function("listen") { declared: Map<String, Map<String, String>> ->
      listening = declared
      val intent = appContext.currentActivity?.intent ?: return@Function null
      // The launching intent is passed on once per process; a launch from the recents list
      // replays the original intent, which was handled when it first arrived.
      if (intent === taken || (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0)
        return@Function null
      val record = record(intent) ?: return@Function null
      taken = intent
      record
    }

    Function("stop") {
      listening = emptyMap()
    }

    AsyncFunction("start") { action: String, targetPackage: String, extras: Map<String, Any?> ->
      val intent = Intent(action).setPackage(targetPackage).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      for ((key, value) in extras)
        when (value) {
          is String -> intent.putExtra(key, value)
          is Boolean -> intent.putExtra(key, value)
          is Number -> putNumber(intent, key, value)
          else -> throw CodedException("ERR_INTENT_EXTRA", "Extra $key is not a flat value", null)
        }
      try {
        (appContext.currentActivity ?: context).startActivity(intent)
      } catch (error: ActivityNotFoundException) {
        throw CodedException("ERR_NO_ACTIVITY", "No activity in $targetPackage takes $action", error)
      }
    }

    OnNewIntent { intent ->
      record(intent)?.let { sendEvent("onIntent", it) }
    }
  }

  /** An intent with a listened-for action, with only that action's declared extras. */
  private fun record(intent: Intent): Bundle? {
    val action = intent.action ?: return null
    val declared = listening[action] ?: return null
    return Bundle().apply {
      putString("action", action)
      intent.categories?.let { putStringArrayList("categories", ArrayList(it)) }
      intent.dataString?.let { putString("data", it) }
      intent.type?.let { putString("type", it) }
      putBundle("extras", extras(intent, declared))
    }
  }

  /**
   * The declared extras the intent carries with the declared type. A sender can put values the
   * app cannot unpack; reading them fails, and the intent is then passed on without extras.
   */
  private fun extras(intent: Intent, declared: Map<String, String>): Bundle {
    val extras = Bundle()
    runCatching {
      val source = intent.extras ?: return extras
      for ((name, type) in declared) {
        if (!source.containsKey(name)) continue
        when (type) {
          "string" -> source.getString(name)?.let { extras.putString(name, it) }
          "boolean" -> source.getBooleanOrNull(name)?.let { extras.putBoolean(name, it) }
          "number" -> source.getNumberOrNull(name)?.let { extras.putDouble(name, it) }
        }
      }
    }.onFailure { extras.clear() }
    return extras
  }

  private fun Bundle.getBooleanOrNull(name: String): Boolean? =
    if (getBoolean(name, false) == getBoolean(name, true)) getBoolean(name) else null

  /** Whole numbers within JavaScript's safe range and finite decimals, as the bridge carries them. */
  private fun Bundle.getNumberOrNull(name: String): Double? {
    @Suppress("DEPRECATION")
    val value = get(name) as? Number ?: return null
    return when (value) {
      is Int, is Short, is Byte -> value.toDouble()
      is Long -> if (value in -MAX_SAFE..MAX_SAFE) value.toDouble() else null
      else -> value.toDouble().takeIf { it.isFinite() }
    }
  }

  /** A whole number goes as an Int when it fits, else as a Long; any other number as a Double. */
  private fun putNumber(intent: Intent, key: String, value: Number) {
    val number = value.toDouble()
    when {
      number % 1.0 != 0.0 -> intent.putExtra(key, number)
      number >= Int.MIN_VALUE && number <= Int.MAX_VALUE -> intent.putExtra(key, number.toInt())
      else -> intent.putExtra(key, number.toLong())
    }
  }

  companion object {
    private const val MAX_SAFE = 9_007_199_254_740_991L

    /** The launching intent already passed on in this process, across JavaScript reloads. */
    private var taken: Intent? = null
  }
}

package dev.tortoise.managedconfig

import android.content.Context
import android.content.RestrictionsManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads the app restrictions a device policy controller (an MDM's agent, or Test DPC) set for this
 * app. Strings pass through; booleans and numbers become their decimal text; any other type
 * becomes null so JavaScript can refuse it by key. Read-only: the app cannot change its own
 * restrictions.
 */
class ManagedConfigModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TortoiseManagedConfig")

    Function("read") {
      val manager = context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager
      val restrictions = manager.applicationRestrictions
      val values = mutableMapOf<String, String?>()
      for (key in restrictions.keySet()) {
        @Suppress("DEPRECATION")
        values[key] = when (val value = restrictions.get(key)) {
          is String -> value
          is Boolean, is Int, is Long -> value.toString()
          else -> null
        }
      }
      values
    }
  }
}

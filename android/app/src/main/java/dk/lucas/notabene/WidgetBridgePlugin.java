package dk.lucas.notabene;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Bridge between the web app and the home screen widgets. */
@CapacitorPlugin(name = "NotabeneWidget")
public class WidgetBridgePlugin extends Plugin {

    static void setPendingAction(Context ctx, String action) {
        WidgetData.prefs(ctx).edit().putString(WidgetData.KEY_ACTION, action).apply();
    }

    /** Stores the latest snapshot (JSON) and redraws every widget. */
    @PluginMethod
    public void update(PluginCall call) {
        String data = call.getString("data");
        if (data == null) { call.reject("data mangler"); return; }
        Context ctx = getContext();
        WidgetData.prefs(ctx).edit().putString(WidgetData.KEY_DATA, data).apply();
        WidgetData.refreshAll(ctx);
        call.resolve();
    }

    /** Returns and clears the action from the last widget tap (or null). */
    @PluginMethod
    public void consumeAction(PluginCall call) {
        SharedPreferences p = WidgetData.prefs(getContext());
        String a = p.getString(WidgetData.KEY_ACTION, null);
        p.edit().remove(WidgetData.KEY_ACTION).apply();
        JSObject r = new JSObject();
        r.put("action", a);
        call.resolve(r);
    }

    /** Returns and clears changes made inside widgets (checked tasks, ticked habits) as a JSON array string. */
    @PluginMethod
    public void consumeOps(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ops", WidgetData.takeOps(getContext()));
        call.resolve(r);
    }
}

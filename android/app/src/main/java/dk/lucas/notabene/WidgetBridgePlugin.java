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
    static final String PREFS = "notabene_widget";
    static final String KEY_DATA = "data";
    static final String KEY_ACTION = "pending_action";

    static void setPendingAction(Context ctx, String action) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_ACTION, action).apply();
    }

    /** Stores the latest snapshot (JSON) and redraws every widget. */
    @PluginMethod
    public void update(PluginCall call) {
        String data = call.getString("data");
        if (data == null) { call.reject("data mangler"); return; }
        Context ctx = getContext();
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_DATA, data).apply();
        NotabeneWidgetProvider.refreshAll(ctx);
        call.resolve();
    }

    /** Returns and clears the action from the last widget tap (or null). */
    @PluginMethod
    public void consumeAction(PluginCall call) {
        SharedPreferences p = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String a = p.getString(KEY_ACTION, null);
        p.edit().remove(KEY_ACTION).apply();
        JSObject r = new JSObject();
        r.put("action", a);
        call.resolve(r);
    }
}

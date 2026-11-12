package dk.lucas.notabene;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Calendar;
import java.util.Locale;

/** Shared helpers for all Notabene widgets: snapshot storage, pending widget actions, intents and dates. */
final class WidgetData {
    static final String PREFS = "notabene_widget";
    static final String KEY_DATA = "data";
    static final String KEY_ACTION = "pending_action";
    static final String KEY_OPS = "pending_ops";
    static final String EXTRA_ACTION = "nb_action";
    static final String[] MONTHS = { "jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec" };
    static final String[] DAYS = { "søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag" };

    private WidgetData() { }

    static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static JSONObject load(Context ctx) {
        String s = prefs(ctx).getString(KEY_DATA, null);
        if (s == null) return null;
        try { return new JSONObject(s); } catch (Exception e) { return null; }
    }

    static void save(Context ctx, JSONObject data) { prefs(ctx).edit().putString(KEY_DATA, data.toString()).apply(); }

    /** Queues a change made in a widget (check a task, tick a habit) for the app to apply next time it runs. */
    static synchronized void addOp(Context ctx, JSONObject op) {
        try {
            JSONArray ops = new JSONArray(prefs(ctx).getString(KEY_OPS, "[]"));
            ops.put(op);
            prefs(ctx).edit().putString(KEY_OPS, ops.toString()).apply();
        } catch (Exception ignored) { }
    }

    static synchronized String takeOps(Context ctx) {
        String s = prefs(ctx).getString(KEY_OPS, "[]");
        prefs(ctx).edit().remove(KEY_OPS).apply();
        return s;
    }

    /** Opens the app with an action ("new", "tasks", "open:<noteId>", ...). */
    static PendingIntent open(Context ctx, String action, int requestCode) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction("dk.lucas.notabene.WIDGET." + requestCode);
        i.putExtra(EXTRA_ACTION, action);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** A broadcast back to a widget provider (used for in-widget toggles). */
    static PendingIntent broadcast(Context ctx, Class<?> provider, String action, int requestCode, String a, String b) {
        Intent i = new Intent(ctx, provider);
        i.setAction(action);
        i.putExtra("a", a);
        i.putExtra("b", b);
        return PendingIntent.getBroadcast(ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static int[] ids(Context ctx, Class<?> provider) {
        return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, provider));
    }

    /** Redraws every Notabene widget on the home screen. */
    static void refreshAll(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        for (int id : ids(ctx, NotabeneWidgetProvider.class)) m.updateAppWidget(id, NotabeneWidgetProvider.build(ctx));
        for (int id : ids(ctx, QuickNoteWidgetProvider.class)) m.updateAppWidget(id, QuickNoteWidgetProvider.build(ctx));
        for (int id : ids(ctx, HabitsWidgetProvider.class)) m.updateAppWidget(id, HabitsWidgetProvider.build(ctx));
        for (int id : ids(ctx, RecentNotesWidgetProvider.class)) m.updateAppWidget(id, RecentNotesWidgetProvider.build(ctx));
        for (int id : ids(ctx, CaptureWidgetProvider.class)) m.updateAppWidget(id, CaptureWidgetProvider.build(ctx));
        for (int id : ids(ctx, NoteWidgetProvider.class)) m.updateAppWidget(id, NoteWidgetProvider.build(ctx, id));
    }

    static String iso(Calendar c) {
        return String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    static String today() { return iso(Calendar.getInstance()); }

    static String daysAgo(int n) { Calendar c = Calendar.getInstance(); c.add(Calendar.DAY_OF_MONTH, -n); return iso(c); }

    /** Days from today to an ISO date (negative = in the past). */
    static int dayDiff(String iso) {
        try {
            String[] p = iso.split("-");
            Calendar due = Calendar.getInstance();
            due.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]), 12, 0, 0);
            Calendar t = Calendar.getInstance();
            t.set(Calendar.HOUR_OF_DAY, 12); t.set(Calendar.MINUTE, 0); t.set(Calendar.SECOND, 0);
            return (int) Math.round((due.getTimeInMillis() - t.getTimeInMillis()) / 86400000.0);
        } catch (Exception e) { return 9999; }
    }

    static String shortDate(long ms) {
        Calendar c = Calendar.getInstance(); c.setTimeInMillis(ms);
        int diff = dayDiff(iso(c));
        if (diff == 0) return "i dag";
        if (diff == -1) return "i går";
        return c.get(Calendar.DAY_OF_MONTH) + ". " + MONTHS[c.get(Calendar.MONTH)];
    }

    static int stickyRes(String color) {
        switch (color == null ? "" : color) {
            case "pink": return R.drawable.widget_sticky_pink;
            case "green": return R.drawable.widget_sticky_green;
            case "blue": return R.drawable.widget_sticky_blue;
            case "orange": return R.drawable.widget_sticky_orange;
            case "purple": return R.drawable.widget_sticky_purple;
            case "white": return R.drawable.widget_sticky_white;
            default: return R.drawable.widget_sticky_yellow;
        }
    }

    static int cardRes(String color) {
        switch (color == null ? "" : color) {
            case "pink": return R.drawable.widget_card_pink;
            case "green": return R.drawable.widget_card_green;
            case "blue": return R.drawable.widget_card_blue;
            case "orange": return R.drawable.widget_card_orange;
            case "purple": return R.drawable.widget_card_purple;
            case "white": return R.drawable.widget_card_white;
            default: return R.drawable.widget_card_yellow;
        }
    }

    static JSONObject findNote(JSONObject data, String id) {
        if (data == null || id == null) return null;
        JSONArray notes = data.optJSONArray("notes");
        if (notes == null) return null;
        for (int i = 0; i < notes.length(); i++) {
            JSONObject n = notes.optJSONObject(i);
            if (n != null && id.equals(n.optString("id"))) return n;
        }
        return null;
    }
}

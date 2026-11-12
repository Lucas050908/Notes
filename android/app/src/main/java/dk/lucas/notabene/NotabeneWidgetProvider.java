package dk.lucas.notabene;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/** "I dag" widget: today's and overdue tasks on a yellow sticky note. Data comes from the web app via WidgetBridgePlugin. */
public class NotabeneWidgetProvider extends AppWidgetProvider {
    static final String EXTRA_ACTION = "nb_action";
    private static final int[] ROWS = { R.id.task1, R.id.task2, R.id.task3, R.id.task4, R.id.task5 };
    private static final int[] ROW_TEXT = { R.id.task1_text, R.id.task2_text, R.id.task3_text, R.id.task4_text, R.id.task5_text };
    private static final int[] ROW_DUE = { R.id.task1_due, R.id.task2_due, R.id.task3_due, R.id.task4_due, R.id.task5_due };
    private static final String[] MONTHS = { "jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec" };
    private static final String[] DAYS = { "søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag" };

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, NotabeneWidgetProvider.class));
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
        int[] quick = mgr.getAppWidgetIds(new ComponentName(ctx, QuickNoteWidgetProvider.class));
        for (int id : quick) mgr.updateAppWidget(id, QuickNoteWidgetProvider.build(ctx));
    }

    static PendingIntent open(Context ctx, String action, int requestCode) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction("dk.lucas.notabene.WIDGET." + requestCode);
        i.putExtra(EXTRA_ACTION, action);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Days between today and an ISO date (negative = overdue). */
    static int dayDiff(String iso) {
        try {
            String[] p = iso.split("-");
            Calendar due = Calendar.getInstance();
            due.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]), 12, 0, 0);
            Calendar today = Calendar.getInstance();
            today.set(Calendar.HOUR_OF_DAY, 12); today.set(Calendar.MINUTE, 0); today.set(Calendar.SECOND, 0);
            return (int) Math.round((due.getTimeInMillis() - today.getTimeInMillis()) / 86400000.0);
        } catch (Exception e) { return 9999; }
    }

    static String dueLabel(String iso) {
        int d = dayDiff(iso);
        if (d == 0) return "I dag";
        if (d == 1) return "I morgen";
        if (d == -1) return "I går";
        if (d < -1) return (-d) + " dage over";
        try {
            String[] p = iso.split("-");
            return Integer.parseInt(p[2]) + ". " + MONTHS[Integer.parseInt(p[1]) - 1];
        } catch (Exception e) { return iso; }
    }

    static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_today);
        Calendar now = Calendar.getInstance();
        String day = DAYS[now.get(Calendar.DAY_OF_WEEK) - 1];
        v.setTextViewText(R.id.date, day.substring(0, 1).toUpperCase(Locale.ROOT) + day.substring(1) + " " + now.get(Calendar.DAY_OF_MONTH) + ". " + MONTHS[now.get(Calendar.MONTH)]);
        v.setOnClickPendingIntent(R.id.root, open(ctx, "tasks", 1));
        v.setOnClickPendingIntent(R.id.add, open(ctx, "new", 2));

        List<JSONObject> today = new ArrayList<>(), later = new ArrayList<>();
        int open = 0;
        JSONObject pinned = null;
        String json = ctx.getSharedPreferences(WidgetBridgePlugin.PREFS, Context.MODE_PRIVATE).getString(WidgetBridgePlugin.KEY_DATA, null);
        if (json != null) {
            try {
                JSONObject data = new JSONObject(json);
                JSONArray tasks = data.optJSONArray("tasks");
                if (tasks != null) for (int i = 0; i < tasks.length(); i++) {
                    JSONObject t = tasks.getJSONObject(i);
                    open++;
                    String due = t.optString("due", "");
                    if (!due.isEmpty() && dayDiff(due) <= 0) today.add(t); else later.add(t);
                }
                pinned = data.optJSONObject("pinned");
            } catch (Exception ignored) { }
        }
        List<JSONObject> show = new ArrayList<>(today);
        for (JSONObject t : later) if (show.size() < ROWS.length) show.add(t);

        v.setTextViewText(R.id.count, today.isEmpty() ? (open == 0 ? "" : open + " åbne") : today.size() + (today.size() == 1 ? " i dag" : " i dag"));
        for (int i = 0; i < ROWS.length; i++) {
            if (i < show.size()) {
                JSONObject t = show.get(i);
                String due = t.optString("due", "");
                v.setViewVisibility(ROWS[i], View.VISIBLE);
                v.setTextViewText(ROW_TEXT[i], t.optString("text", ""));
                v.setTextViewText(ROW_DUE[i], due.isEmpty() ? "" : dueLabel(due));
                v.setTextColor(ROW_DUE[i], !due.isEmpty() && dayDiff(due) < 0 ? 0xFFB3261E : 0xFF2B4BD8);
                v.setOnClickPendingIntent(ROWS[i], open(ctx, "open:" + t.optString("noteId", ""), 10 + i));
            } else {
                v.setViewVisibility(ROWS[i], View.GONE);
            }
        }
        if (show.isEmpty()) {
            v.setViewVisibility(R.id.empty, View.VISIBLE);
            if (pinned != null) {
                v.setTextViewText(R.id.empty, "Ingen opgaver i dag ✓\n\nFastgjort: " + pinned.optString("title", ""));
                v.setOnClickPendingIntent(R.id.empty, open(ctx, "open:" + pinned.optString("id", ""), 20));
            } else {
                v.setTextViewText(R.id.empty, json == null ? "Åbn Notabene én gang for at vise dine opgaver her." : "Ingen opgaver i dag ✓");
            }
        } else {
            v.setViewVisibility(R.id.empty, View.GONE);
        }
        return v;
    }
}

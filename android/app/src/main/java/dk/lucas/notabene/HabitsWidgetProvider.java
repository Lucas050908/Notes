package dk.lucas.notabene;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Set;

/** 4×2 widget: habits with the last 7 days; tap today's box to tick it off. */
public class HabitsWidgetProvider extends AppWidgetProvider {
    static final String TOGGLE = "dk.lucas.notabene.TOGGLE_HABIT";
    private static final int[] ROWS = { R.id.habit1, R.id.habit2, R.id.habit3, R.id.habit4 };
    private static final int[] LABELS = { R.id.habit1_label, R.id.habit2_label, R.id.habit3_label, R.id.habit4_label };
    private static final int[] NAMES = { R.id.habit1_name, R.id.habit2_name, R.id.habit3_name, R.id.habit4_name };
    private static final int[] STREAKS = { R.id.habit1_streak, R.id.habit2_streak, R.id.habit3_streak, R.id.habit4_streak };
    private static final int[][] DAYS = {
        { R.id.habit1_d0, R.id.habit1_d1, R.id.habit1_d2, R.id.habit1_d3, R.id.habit1_d4, R.id.habit1_d5, R.id.habit1_d6 },
        { R.id.habit2_d0, R.id.habit2_d1, R.id.habit2_d2, R.id.habit2_d3, R.id.habit2_d4, R.id.habit2_d5, R.id.habit2_d6 },
        { R.id.habit3_d0, R.id.habit3_d1, R.id.habit3_d2, R.id.habit3_d3, R.id.habit3_d4, R.id.habit3_d5, R.id.habit3_d6 },
        { R.id.habit4_d0, R.id.habit4_d1, R.id.habit4_d2, R.id.habit4_d3, R.id.habit4_d4, R.id.habit4_d5, R.id.habit4_d6 },
    };
    private static final String LETTERS = "SMTOTFL"; // indexed by Calendar.DAY_OF_WEEK - 1 (søndag first)

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (TOGGLE.equals(intent.getAction())) {
            String id = intent.getStringExtra("a");
            JSONObject data = WidgetData.load(ctx);
            JSONArray habits = data == null ? null : data.optJSONArray("habits");
            if (habits != null && id != null) {
                String today = WidgetData.today();
                for (int i = 0; i < habits.length(); i++) {
                    JSONObject h = habits.optJSONObject(i);
                    if (h == null || !id.equals(h.optString("id"))) continue;
                    JSONArray done = h.optJSONArray("done"), next = new JSONArray();
                    boolean was = false;
                    if (done != null) for (int k = 0; k < done.length(); k++) { String d = done.optString(k); if (today.equals(d)) was = true; else next.put(d); }
                    if (!was) next.put(today);
                    try {
                        h.put("done", next);
                        JSONObject op = new JSONObject();
                        op.put("t", "habit"); op.put("id", id); op.put("date", today); op.put("on", !was);
                        WidgetData.addOp(ctx, op);
                    } catch (Exception ignored) { }
                }
                WidgetData.save(ctx, data);
                WidgetData.refreshAll(ctx);
            }
            return;
        }
        super.onReceive(ctx, intent);
    }

    static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_habits);
        v.setOnClickPendingIntent(R.id.habits_root, WidgetData.open(ctx, "habits", 9));
        JSONObject data = WidgetData.load(ctx);
        JSONArray habits = data == null ? null : data.optJSONArray("habits");
        int count = habits == null ? 0 : Math.min(habits.length(), ROWS.length), doneToday = 0;
        String today = WidgetData.today();
        for (int i = 0; i < ROWS.length; i++) {
            JSONObject h = i < count ? habits.optJSONObject(i) : null;
            if (h == null) { v.setViewVisibility(ROWS[i], View.GONE); continue; }
            Set<String> done = new HashSet<>();
            JSONArray arr = h.optJSONArray("done");
            if (arr != null) for (int k = 0; k < arr.length(); k++) done.add(arr.optString(k));
            if (done.contains(today)) doneToday++;
            int streak = 0, start = done.contains(today) ? 0 : 1;
            while (done.contains(WidgetData.daysAgo(start + streak))) streak++;
            v.setViewVisibility(ROWS[i], View.VISIBLE);
            v.setTextViewText(NAMES[i], h.optString("name", ""));
            v.setTextViewText(STREAKS[i], streak > 0 ? streak + (streak == 1 ? " dag i træk" : " dage i træk") : "");
            v.setOnClickPendingIntent(LABELS[i], WidgetData.open(ctx, "habits", 50 + i));
            for (int d = 0; d < 7; d++) {
                int ago = 6 - d;
                Calendar c = Calendar.getInstance(); c.add(Calendar.DAY_OF_MONTH, -ago);
                boolean on = done.contains(WidgetData.iso(c));
                int cell = DAYS[i][d];
                v.setTextViewText(cell, String.valueOf(LETTERS.charAt(c.get(Calendar.DAY_OF_WEEK) - 1)));
                v.setInt(cell, "setBackgroundResource", on ? R.drawable.widget_day_on : ago == 0 ? R.drawable.widget_day_today : R.drawable.widget_day_off);
                v.setTextColor(cell, on ? 0xFFFFFFFF : 0xFF736C5B);
                if (ago == 0) v.setOnClickPendingIntent(cell, WidgetData.broadcast(ctx, HabitsWidgetProvider.class, TOGGLE, 60 + i, h.optString("id"), ""));
            }
        }
        v.setTextViewText(R.id.habits_summary, count == 0 ? "" : doneToday + "/" + count + " i dag");
        v.setViewVisibility(R.id.habits_empty, count == 0 ? View.VISIBLE : View.GONE);
        if (count == 0) v.setTextViewText(R.id.habits_empty, data == null ? "Åbn Notabene én gang for at vise dine vaner her." : "Ingen vaner endnu. Tryk for at oprette en.");
        return v;
    }
}

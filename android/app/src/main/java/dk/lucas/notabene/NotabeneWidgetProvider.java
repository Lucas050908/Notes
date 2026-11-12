package dk.lucas.notabene;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
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

/** "I dag" widget: today's and overdue tasks on a yellow sticky note. Tasks can be checked off right here. */
public class NotabeneWidgetProvider extends AppWidgetProvider {
    static final String EXTRA_ACTION = WidgetData.EXTRA_ACTION;
    static final String TOGGLE = "dk.lucas.notabene.TOGGLE_TASK";
    private static final int[] ROWS = { R.id.task1, R.id.task2, R.id.task3, R.id.task4, R.id.task5 };
    private static final int[] ROW_BOX = { R.id.task1_box, R.id.task2_box, R.id.task3_box, R.id.task4_box, R.id.task5_box };
    private static final int[] ROW_TEXT = { R.id.task1_text, R.id.task2_text, R.id.task3_text, R.id.task4_text, R.id.task5_text };
    private static final int[] ROW_DUE = { R.id.task1_due, R.id.task2_due, R.id.task3_due, R.id.task4_due, R.id.task5_due };

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (TOGGLE.equals(intent.getAction())) {
            String noteId = intent.getStringExtra("a"), key = intent.getStringExtra("b");
            JSONObject data = WidgetData.load(ctx);
            if (data != null && noteId != null && key != null) {
                JSONArray tasks = data.optJSONArray("tasks"), keep = new JSONArray();
                if (tasks != null) for (int i = 0; i < tasks.length(); i++) {
                    JSONObject t = tasks.optJSONObject(i);
                    if (t == null) continue;
                    if (noteId.equals(t.optString("noteId")) && key.equals(t.optInt("i") + "|" + t.optString("text"))) {
                        try {
                            JSONObject op = new JSONObject();
                            op.put("t", "task"); op.put("noteId", noteId); op.put("i", t.optInt("i")); op.put("text", t.optString("text"));
                            WidgetData.addOp(ctx, op);
                        } catch (Exception ignored) { }
                    } else keep.put(t);
                }
                try { data.put("tasks", keep); } catch (Exception ignored) { }
                WidgetData.save(ctx, data);
                WidgetData.refreshAll(ctx);
            }
            return;
        }
        super.onReceive(ctx, intent);
    }

    static String dueLabel(String iso) {
        int d = WidgetData.dayDiff(iso);
        if (d == 0) return "I dag";
        if (d == 1) return "I morgen";
        if (d == -1) return "I går";
        if (d < -1) return (-d) + " dage over";
        try {
            String[] p = iso.split("-");
            return Integer.parseInt(p[2]) + ". " + WidgetData.MONTHS[Integer.parseInt(p[1]) - 1];
        } catch (Exception e) { return iso; }
    }

    static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_today);
        Calendar now = Calendar.getInstance();
        String day = WidgetData.DAYS[now.get(Calendar.DAY_OF_WEEK) - 1];
        v.setTextViewText(R.id.date, day.substring(0, 1).toUpperCase(Locale.ROOT) + day.substring(1) + " " + now.get(Calendar.DAY_OF_MONTH) + ". " + WidgetData.MONTHS[now.get(Calendar.MONTH)]);
        v.setOnClickPendingIntent(R.id.root, WidgetData.open(ctx, "tasks", 1));
        v.setOnClickPendingIntent(R.id.add, WidgetData.open(ctx, "new", 2));

        List<JSONObject> today = new ArrayList<>(), later = new ArrayList<>();
        int open = 0;
        JSONObject data = WidgetData.load(ctx), pinned = null;
        if (data != null) {
            JSONArray tasks = data.optJSONArray("tasks");
            if (tasks != null) for (int i = 0; i < tasks.length(); i++) {
                JSONObject t = tasks.optJSONObject(i);
                if (t == null) continue;
                open++;
                String due = t.optString("due", "");
                if (!due.isEmpty() && WidgetData.dayDiff(due) <= 0) today.add(t); else later.add(t);
            }
            pinned = data.optJSONObject("pinned");
        }
        List<JSONObject> show = new ArrayList<>(today);
        for (JSONObject t : later) if (show.size() < ROWS.length) show.add(t);

        v.setTextViewText(R.id.count, today.isEmpty() ? (open == 0 ? "" : open + " åbne opgaver") : today.size() + " i dag");
        for (int i = 0; i < ROWS.length; i++) {
            if (i < show.size()) {
                JSONObject t = show.get(i);
                String due = t.optString("due", ""), noteId = t.optString("noteId", "");
                v.setViewVisibility(ROWS[i], View.VISIBLE);
                v.setTextViewText(ROW_TEXT[i], t.optString("text", ""));
                v.setTextViewText(ROW_DUE[i], due.isEmpty() ? "" : dueLabel(due));
                v.setTextColor(ROW_DUE[i], !due.isEmpty() && WidgetData.dayDiff(due) < 0 ? 0xFFB3261E : 0xFF2B4BD8);
                v.setOnClickPendingIntent(ROWS[i], WidgetData.open(ctx, "open:" + noteId, 10 + i));
                v.setOnClickPendingIntent(ROW_BOX[i], WidgetData.broadcast(ctx, NotabeneWidgetProvider.class, TOGGLE, 30 + i, noteId, t.optInt("i") + "|" + t.optString("text")));
            } else {
                v.setViewVisibility(ROWS[i], View.GONE);
            }
        }
        if (show.isEmpty()) {
            v.setViewVisibility(R.id.empty, View.VISIBLE);
            if (pinned != null) {
                v.setTextViewText(R.id.empty, "Ingen opgaver ✓\n\nFastgjort: " + pinned.optString("title", ""));
                v.setOnClickPendingIntent(R.id.empty, WidgetData.open(ctx, "open:" + pinned.optString("id", ""), 20));
            } else {
                v.setTextViewText(R.id.empty, data == null ? "Åbn Notabene én gang for at vise dine opgaver her." : "Ingen opgaver ✓");
            }
        } else {
            v.setViewVisibility(R.id.empty, View.GONE);
        }
        return v;
    }
}

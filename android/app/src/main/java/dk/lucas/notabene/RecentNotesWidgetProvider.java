package dk.lucas.notabene;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/** 4×2 widget: the three most recently edited notes as small sticky notes. */
public class RecentNotesWidgetProvider extends AppWidgetProvider {
    private static final int[] CARDS = { R.id.card1, R.id.card2, R.id.card3 };
    private static final int[] TITLES = { R.id.card1_title, R.id.card2_title, R.id.card3_title };
    private static final int[] BODIES = { R.id.card1_body, R.id.card2_body, R.id.card3_body };

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_recent);
        v.setOnClickPendingIntent(R.id.recent_add, WidgetData.open(ctx, "new", 7));
        v.setOnClickPendingIntent(R.id.recent_root, WidgetData.open(ctx, "notes", 8));
        JSONObject data = WidgetData.load(ctx);
        JSONArray notes = data == null ? null : data.optJSONArray("notes");
        int shown = 0;
        for (int i = 0; i < CARDS.length; i++) {
            JSONObject n = notes != null && i < notes.length() ? notes.optJSONObject(i) : null;
            if (n == null) { v.setViewVisibility(CARDS[i], View.INVISIBLE); continue; }
            shown++;
            v.setViewVisibility(CARDS[i], View.VISIBLE);
            v.setInt(CARDS[i], "setBackgroundResource", WidgetData.cardRes(n.optString("color")));
            v.setTextViewText(TITLES[i], n.optString("title", ""));
            v.setTextViewText(BODIES[i], n.optString("snippet", ""));
            v.setOnClickPendingIntent(CARDS[i], WidgetData.open(ctx, "open:" + n.optString("id"), 40 + i));
        }
        v.setViewVisibility(R.id.recent_empty, shown == 0 ? View.VISIBLE : View.GONE);
        return v;
    }
}

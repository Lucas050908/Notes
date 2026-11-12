package dk.lucas.notabene;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import org.json.JSONObject;

/** 2×2 widget: one chosen note, shown as a sticky note in the note's own colour. */
public class NoteWidgetProvider extends AppWidgetProvider {
    static String key(int widgetId) { return "note_" + widgetId; }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, id));
    }

    @Override
    public void onDeleted(Context ctx, int[] ids) {
        SharedPreferences.Editor e = WidgetData.prefs(ctx).edit();
        for (int id : ids) e.remove(key(id));
        e.apply();
    }

    static RemoteViews build(Context ctx, int widgetId) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_note);
        String noteId = WidgetData.prefs(ctx).getString(key(widgetId), null);
        JSONObject data = WidgetData.load(ctx);
        JSONObject n = WidgetData.findNote(data, noteId);
        if (n == null && noteId == null && data != null) n = data.optJSONObject("pinned") != null ? WidgetData.findNote(data, data.optJSONObject("pinned").optString("id")) : null;
        if (n == null) {
            v.setTextViewText(R.id.note_title, noteId == null ? "Vælg en note" : "Noten findes ikke");
            v.setTextViewText(R.id.note_body, noteId == null ? "Hold fingeren på widgetten og vælg Indstillinger for at vælge en note." : "Den er slettet eller ikke blandt dine seneste noter. Vælg en anden via widgettens indstillinger.");
            v.setTextViewText(R.id.note_meta, "");
            v.setInt(R.id.note_card, "setBackgroundResource", R.drawable.widget_sticky_white);
            v.setOnClickPendingIntent(R.id.note_root, WidgetData.open(ctx, "notes", 100 + (widgetId % 1000)));
            return v;
        }
        v.setInt(R.id.note_card, "setBackgroundResource", WidgetData.stickyRes(n.optString("color")));
        v.setTextViewText(R.id.note_title, n.optString("title", ""));
        v.setTextViewText(R.id.note_body, n.optString("snippet", ""));
        long updated = n.optLong("updated", 0);
        v.setTextViewText(R.id.note_meta, updated > 0 ? "Ændret " + WidgetData.shortDate(updated) : "");
        v.setOnClickPendingIntent(R.id.note_root, WidgetData.open(ctx, "open:" + n.optString("id"), 100 + (widgetId % 1000)));
        return v;
    }
}

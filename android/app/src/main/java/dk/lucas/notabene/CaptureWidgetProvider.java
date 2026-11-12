package dk.lucas.notabene;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

/** 4×1 bar: "Fang en tanke…" opens quick capture; buttons for today's note and a new note. */
public class CaptureWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_capture);
        v.setOnClickPendingIntent(R.id.capture_field, WidgetData.open(ctx, "capture", 4));
        v.setOnClickPendingIntent(R.id.capture_daily, WidgetData.open(ctx, "daily", 5));
        v.setOnClickPendingIntent(R.id.capture_new, WidgetData.open(ctx, "new", 6));
        return v;
    }
}

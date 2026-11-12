package dk.lucas.notabene;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

/** Lets the user pick which note a "Sticky note" widget shows. */
public class NoteWidgetConfigActivity extends Activity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    private int dp(int v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);
        Bundle extras = getIntent().getExtras();
        if (extras != null) widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }

        final List<JSONObject> notes = new ArrayList<>();
        JSONObject data = WidgetData.load(this);
        JSONArray arr = data == null ? null : data.optJSONArray("notes");
        if (arr != null) for (int i = 0; i < arr.length(); i++) { JSONObject n = arr.optJSONObject(i); if (n != null) notes.add(n); }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#12110F"));
        root.setPadding(dp(20), dp(28), dp(20), dp(12));
        TextView title = new TextView(this);
        title.setText(R.string.widget_pick_note);
        title.setTextColor(Color.parseColor("#EFEAE0"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 30);
        if (Build.VERSION.SDK_INT >= 26) { try { title.setTypeface(getResources().getFont(R.font.caveat_bold)); } catch (Exception ignored) { } }
        root.addView(title);

        if (notes.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText(R.string.widget_open_first);
            empty.setTextColor(Color.parseColor("#ACA596"));
            empty.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            empty.setPadding(0, dp(16), 0, 0);
            root.addView(empty);
            setContentView(root);
            return;
        }

        ListView list = new ListView(this);
        list.setDivider(null);
        list.setDividerHeight(dp(8));
        list.setPadding(0, dp(12), 0, 0);
        list.setClipToPadding(false);
        list.setAdapter(new ArrayAdapter<JSONObject>(this, 0, notes) {
            @Override
            public View getView(int position, View convert, ViewGroup parent) {
                JSONObject n = getItem(position);
                LinearLayout row = new LinearLayout(getContext());
                row.setOrientation(LinearLayout.VERTICAL);
                row.setPadding(dp(16), dp(12), dp(16), dp(12));
                row.setBackgroundResource(WidgetData.cardRes(n.optString("color")));
                TextView t = new TextView(getContext());
                t.setText((n.optBoolean("pinned") ? "📌 " : "") + n.optString("title"));
                t.setTextColor(Color.parseColor("#1D1B17"));
                t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
                t.setTypeface(Typeface.DEFAULT_BOLD);
                t.setMaxLines(1);
                TextView s = new TextView(getContext());
                s.setText(n.optString("snippet"));
                s.setTextColor(Color.parseColor("#4B4639"));
                s.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
                s.setMaxLines(2);
                row.addView(t);
                row.addView(s);
                return row;
            }
        });
        list.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> p, View view, int position, long id) {
                pick(notes.get(position).optString("id"));
            }
        });
        root.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        root.setGravity(Gravity.TOP);
    }

    private void pick(String noteId) {
        WidgetData.prefs(this).edit().putString(NoteWidgetProvider.key(widgetId), noteId).apply();
        AppWidgetManager.getInstance(this).updateAppWidget(widgetId, NoteWidgetProvider.build(this, widgetId));
        Intent result = new Intent();
        result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, result);
        finish();
    }
}

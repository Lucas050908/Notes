package dk.lucas.notabene;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
        captureWidgetAction(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        captureWidgetAction(intent);
    }

    /** Widget taps start the app with an "nb_action" extra; the web layer picks it up via NotabeneWidget.consumeAction(). */
    private void captureWidgetAction(Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra(NotabeneWidgetProvider.EXTRA_ACTION);
        if (action != null) {
            WidgetBridgePlugin.setPendingAction(this, action);
            intent.removeExtra(NotabeneWidgetProvider.EXTRA_ACTION);
        }
    }
}

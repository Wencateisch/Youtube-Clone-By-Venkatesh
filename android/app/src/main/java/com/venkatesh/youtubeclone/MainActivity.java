package com.venkatesh.youtubeclone;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // The system back gesture/button must not simply kill the app: first give the
        // web layer a chance to consume it (e.g. to dismiss the video player sheet).
        // The web layer exposes window.__onAndroidBack(), which returns true when it
        // handled the event.
        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    if (bridge == null || bridge.getWebView() == null) {
                        finish();
                        return;
                    }
                    bridge.getWebView()
                        .evaluateJavascript(
                            "(function(){try{return !!(window.__onAndroidBack && window.__onAndroidBack());}catch(e){return false;}})()",
                            value -> {
                                if (!"true".equals(value)) {
                                    finish();
                                }
                            }
                        );
                }
            }
        );
    }
}

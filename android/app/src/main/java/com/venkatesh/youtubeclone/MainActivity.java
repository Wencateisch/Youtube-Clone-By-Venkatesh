package com.venkatesh.youtubeclone;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Only true while the web layer reports an actively playing video.
    private volatile boolean playbackActive = false;

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

        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            // Only a boolean setter is exposed, so nothing sensitive is reachable
            // from page content or the embedded YouTube frame.
            webView.addJavascriptInterface(new PlaybackBridge(), "AndroidPlayback");
        }
    }

    private class PlaybackBridge {
        @JavascriptInterface
        public void setPlaybackActive(boolean active) {
            playbackActive = active;
        }
    }

    @Override
    public void onPause() {
        super.onPause();

        // Capacitor's KeepRunning default leaves the JS bridge alive, but Chromium
        // still throttles a WebView the activity has paused. Resuming the view (and
        // its timers) keeps the YouTube iframe's audio running when the app is
        // minimised. It is skipped as soon as playback stops, so an idle app is not
        // kept awake.
        if (playbackActive && !isFinishing() && !isDestroyed()
            && bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().onResume();
            bridge.getWebView().resumeTimers();
        }
    }
}

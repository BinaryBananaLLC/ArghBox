# ArghBox in mobile apps

Your app can show the whole feedback board in a WebView. Players and users see the list, search, vote, add their own, see "Your arghs" and report posts. There is nothing to sign in to, and you write no native screens.

This page is for developers who already installed ArghBox on their site (see [install.md](install.md)).

## Why

- **No sign-in.** The board uses the same anonymous voter key as the web widget. The key and the receipts live in the WebView's `localStorage`, which stays on the phone for as long as the app is installed.
- **The whole board in the app.** One URL, one WebView. Fixes to the board reach every app the moment you upload them. You do not ship an app update.
- **Safe to show in an app.** Entries wait for review before they are public, visitors can report entries, and you can block an author. That is what the App Store and Google Play ask of apps with user posts (checklist below).

## Quick start

Open this address in a WebView:

```
https://example.com/arghbox/app.html?platform=ios&version=2.3.1&from=/settings
```

Use your own site instead of `example.com`. The page is `arghbox/app.html`. It is uploaded with the rest of the `arghbox/` folder.

All parameters are optional. A value that is not valid is ignored. Encode every value you put into the URL (`URLComponents`, `Uri.encode`, `encodeURIComponent`).

| Parameter | Values | What it does |
|---|---|---|
| `platform` | `ios`, `android`, `other` (any letter case) | Stored with each new entry, so you see where it came from ("App: iOS 2.3.1" on the admin page). |
| `version` | 1 to 20 characters from `0-9 A-Z a-z . _ + -` | Your app's version, stored with each new entry. Encode `+` as `%2B`. An unencoded `+` arrives as a space, which the page reads as `+`. |
| `from` | A path that starts with one `/` (not `//`), at most 200 characters, no `?`, `#` or spaces | The app screen the visitor came from, for example `/settings`. It is stored as the page of the entry. Default `/`. |
| `view` | `list`, `add` | What opens first. Default `list`. |
| `type` | `idea`, `bug`, `question` | The type that is already selected on the add form. |
| `theme` | `auto`, `light`, `dark` | Default `auto`: follows the phone. Use `light` or `dark` to match your app. |
| `accent` | `#rgb` or `#rrggbb` | The accent colour. Write `#` as `%23` in the URL. |
| `lang` | 2 to 12 letters or `-`, for example `pl` | The language of the board. Default: the phone's language. |
| `tone` | `funny`, `neutral` | The wording. Default `funny`. |

A link such as `app.html#arghbox-add` or `#arghbox-bug` opens the add form, and `#arghbox-12` opens entry 12, like on the web.

The page needs no setup in `config.php`. Turnstile works on it as it does on your site (see below). Optionally set `contact_url` so the board shows a "Contact" link, which the stores ask for (see the checklist).

## The bridge: messages to your app

The page tells your app what happens. It posts one message for each of these events: `open`, `close`, `add` and `vote`. It also posts `link`, when the visitor taps a link (see below).

```json
{ "source": "arghbox", "type": "close", "detail": {} }
```

- `source` is always `"arghbox"`. Check it, so you ignore messages from other scripts.
- `type` is `open`, `close`, `add`, `vote` or `link`.
- `detail` is the event's detail: `{"type": "bug"}` for `add`, `{"on": true}` for `vote`, `{"url": "https://..."}` for `link`, `{}` for the others. It never holds anything a visitor wrote.

| `type` | When | `detail` |
|---|---|---|
| `open` | The board opened | `{}` |
| `close` | The visitor closed the board | `{}` |
| `add` | The visitor sent an entry | `{"type": "idea"}` |
| `vote` | The visitor voted or took a vote back | `{"on": true}` |
| `link` | The visitor tapped a link (Contact, the credit link, a link in your comment) | `{"url": "..."}`, always `http:`, `https:` or `mailto:` |

The page posts to every bridge it finds. Each platform gets the message in its own way:

| App | The page calls | You receive |
|---|---|---|
| Swift (WKWebView) | `window.webkit.messageHandlers.arghbox.postMessage(object)` | A `WKScriptMessageHandler` named `arghbox`, with `message.body` as a dictionary |
| Kotlin (WebView) | `window.ArghBoxAndroid.postMessage(string)` | An object added with `addJavascriptInterface(obj, "ArghBoxAndroid")`, with a JSON string |
| React Native | `window.ReactNativeWebView.postMessage(string)` | The `onMessage` prop of `react-native-webview`, with a JSON string in `event.nativeEvent.data` |
| Flutter | `window.ArghBoxFlutter.postMessage(string)` | A `JavaScriptChannel` named `ArghBoxFlutter`, with a JSON string |

The Flutter channel is not called `ArghBox`, because that name is the widget's own JavaScript API.

**Closing.** When the visitor closes the board, the page posts `close` to the bridge. **An app that installs a bridge must handle `close`**: the page does not navigate anywhere then, and the visitor would be left on a blank page. If your app has no bridge, the page goes to the fixed address `arghbox://close`. Catch that address in your navigation callback and close the screen. (A normal browser cannot open it, so it shows a "Feedback closed" screen with an "Open again" button.) Catching the address is the simplest way. The examples below do both.

**Links.** The board's links open in a new window, which a WKWebView ignores and other WebViews open inside the page. So when a bridge exists, the page does not follow a link: it posts `link` with the address, and your app opens it in the system browser. Without a bridge, links behave as in a browser, and you decide what a new window does (the Swift example shows how).

## Swift

`WKUserContentController.add(_:name:)` keeps a strong reference to its handler, so a view controller that adds itself is never freed. Use a small weak proxy.

```swift
import UIKit
import WebKit

/// Holds the real handler weakly, so the web view does not keep the view controller alive.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

final class FeedbackViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()          // persistent: keeps the voter key between launches
        config.userContentController.add(WeakHandler(self), name: "arghbox")
        webView = WKWebView(frame: .zero, configuration: config)   // do not set customUserAgent
        webView.navigationDelegate = self
        webView.uiDelegate = self
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        var url = URLComponents(string: "https://example.com/arghbox/app.html")!
        url.queryItems = [                              // URLComponents encodes the values
            URLQueryItem(name: "platform", value: "ios"),
            URLQueryItem(name: "version", value: version),
            URLQueryItem(name: "from", value: "/settings"),
        ]
        webView.load(URLRequest(url: url.url!))
    }

    // Messages from the page: {source: "arghbox", type, detail}
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], body["source"] as? String == "arghbox" else { return }
        switch body["type"] as? String {
        case "close":
            dismiss(animated: true)
        case "link":   // Contact, the credit link: open it in Safari (or Mail for mailto:)
            if let detail = body["detail"] as? [String: Any],
               let text = detail["url"] as? String, let link = URL(string: text) {
                UIApplication.shared.open(link)
            }
        default:
            break
        }
    }

    // The fallback: the page goes to arghbox://close
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.request.url?.absoluteString == "arghbox://close" {
            decisionHandler(.cancel)
            dismiss(animated: true)
        } else {
            decisionHandler(.allow)
        }
    }

    // Links that open a new window (target=_blank). With the bridge you receive "link" instead and never get here.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let link = navigationAction.request.url { UIApplication.shared.open(link) }
        return nil
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || isMovingFromParent {   // the screen is really gone
            webView.configuration.userContentController.removeScriptMessageHandler(forName: "arghbox")
        }
    }
}
```

With the weak proxy the removal in `viewDidDisappear` is only tidiness. There is no `deinit` removal: `deinit` never runs while the handler is still strongly held.

## Kotlin

Your manifest needs the internet permission: `<uses-permission android:name="android.permission.INTERNET" />`.

```kotlin
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

class FeedbackActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    // window.ArghBoxAndroid.postMessage("<json>")
    inner class Bridge {
        @JavascriptInterface
        fun postMessage(json: String) {
            val message = try { JSONObject(json) } catch (e: Exception) { return }
            if (message.optString("source") != "arghbox") return
            when (message.optString("type")) {
                "close" -> runOnUiThread { finish() }      // the bridge runs on a background thread
                "link" -> {
                    val url = message.optJSONObject("detail")?.optString("url") ?: return
                    runOnUiThread { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        // Android 15 draws apps edge to edge: keep the page out from under the status and navigation bars.
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true   // localStorage: the voter key
        // do not change settings.userAgentString
        webView.addJavascriptInterface(Bridge(), "ArghBoxAndroid")

        webView.webViewClient = object : WebViewClient() {
            // The fallback: the page goes to arghbox://close
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.toString() == "arghbox://close") {
                    finish()
                    return true
                }
                return false
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        val info = if (Build.VERSION.SDK_INT >= 33) {
            packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION") packageManager.getPackageInfo(packageName, 0)
        }
        val version = Uri.encode(info.versionName ?: "")   // encodes a "+" as %2B
        webView.loadUrl("https://example.com/arghbox/app.html?platform=android&version=$version&from=/settings")
    }
}
```

With a layout that already handles insets (a `Scaffold`, `fitsSystemWindows`, or an app that is not edge to edge) leave the insets listener out.

## React Native

With [react-native-webview](https://github.com/react-native-webview/react-native-webview). It keeps `localStorage` between launches on both platforms.

```jsx
import React from 'react';
import { Linking, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

export default function FeedbackScreen({ navigation }) {
  const version = '2.3.1'; // your app's version
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'other';
  const uri = `https://example.com/arghbox/app.html?platform=${platform}&version=${encodeURIComponent(version)}&from=${encodeURIComponent('/settings')}`;

  return (
    <WebView
      source={{ uri }}
      // Without arghbox://* here the fallback address is blocked before onShouldStartLoadWithRequest sees it.
      originWhitelist={['https://*', 'arghbox://*']}
      javaScriptEnabled
      domStorageEnabled
      onMessage={(event) => {
        let message = null;
        try { message = JSON.parse(event.nativeEvent.data); } catch (e) { return; }
        if (!message || message.source !== 'arghbox') return;
        if (message.type === 'close') navigation.goBack();
        if (message.type === 'link' && message.detail && message.detail.url) Linking.openURL(message.detail.url);
      }}
      onShouldStartLoadWithRequest={(request) => {
        if (request.url === 'arghbox://close') { navigation.goBack(); return false; } // the fallback
        return true;
      }}
    />
  );
}
```

## Flutter

With [webview_flutter](https://pub.dev/packages/webview_flutter) and [url_launcher](https://pub.dev/packages/url_launcher).

```dart
import 'dart:convert';
import 'dart:io' show Platform;
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

class FeedbackPage extends StatefulWidget {
  const FeedbackPage({super.key});
  @override
  State<FeedbackPage> createState() => _FeedbackPageState();
}

class _FeedbackPageState extends State<FeedbackPage> {
  late final WebViewController controller;

  @override
  void initState() {
    super.initState();
    const version = '2.3.1'; // your app's version
    final platform = Platform.isIOS ? 'ios' : (Platform.isAndroid ? 'android' : 'other');
    final uri = Uri.https('example.com', '/arghbox/app.html',
        {'platform': platform, 'version': version, 'from': '/settings'}); // Uri encodes the values
    controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel('ArghBoxFlutter', onMessageReceived: (message) {
        try {
          final data = jsonDecode(message.message);
          if (data['source'] != 'arghbox') return;
          if (data['type'] == 'close') Navigator.of(context).pop();
          if (data['type'] == 'link') {
            launchUrl(Uri.parse(data['detail']['url']), mode: LaunchMode.externalApplication);
          }
        } catch (_) {}
      })
      ..setNavigationDelegate(NavigationDelegate(onNavigationRequest: (request) {
        if (request.url == 'arghbox://close') {      // the fallback
          Navigator.of(context).pop();
          return NavigationDecision.prevent;
        }
        return NavigationDecision.navigate;
      }))
      ..loadRequest(uri);
  }

  @override
  Widget build(BuildContext context) => Scaffold(body: SafeArea(child: WebViewWidget(controller: controller)));
}
```

## Turnstile in a WebView

Posting, voting and reporting need a pass, and a pass comes from a Cloudflare Turnstile check. Turnstile works in a WebView when:

- the page is served from **your site's own https address** (it is: `app.html` lives in your `arghbox/` folder, and the host must match `site_url`),
- **JavaScript** and **DOM storage** are on (the Kotlin and React Native examples set them; they are on by default in WKWebView and in Flutter once JavaScript is unrestricted),
- the WebView uses the **default user agent**. Do not set `customUserAgent` or `userAgentString`.

Cloudflare describes this in [Turnstile for mobile apps](https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/). The list and the search work without Turnstile. It only shows when the visitor posts, votes or reports, and only if Cloudflare needs a click.

## The `app_pass` fallback

Some WebViews cannot pass Turnstile: an old Android System WebView, a locked-down kiosk, a game engine's embedded browser. For those, you can set this in `config.php`:

```php
'app_pass' => true,
```

Then `app.html` asks for a pass without the human check (`POST session` with `{"app": true}`), and Turnstile is not loaded on that page at all.

The trade-off, honestly: **this is weaker.** Anyone can ask for that pass, with a script and no app. It proves neither a person nor your app. What still protects you:

- Every new entry waits for your review (or triage) before it is public.
- The rate limits stay: per IP, `entries_per_hour`, `votes_per_hour`, `reports_per_hour` and `sessions_per_hour`, and the whole site's `sessions_global_per_hour`.

What gets worse: votes are now limited only by `votes_per_ip_per_entry` and `votes_per_hour`, so a determined person can push a vote count up, and Turnstile no longer protects the web widget either, because the pass works for both. The health check reports `app_pass: true`, and shows a warning to the owner.

The first choice is to leave `app_pass` off. Turn it on only if you find that your users really cannot pass Turnstile.

## App Store and Google Play checklist

Apple's App Review Guideline 1.2 asks apps with user-generated content for filtering, reporting, blocking and contact information. Google Play's user-generated content policy asks for much the same. Read the current text yourself: [Apple's guidelines (user-generated content)](https://developer.apple.com/app-store/review/guidelines/#user-generated-content).

| The store asks for | ArghBox has |
|---|---|
| A method for filtering objectionable material | Nothing is public before review. New entries are `pending` until you or the triage skill publish them. Triage rejects spam and abuse. |
| A mechanism to report offensive content, with timely responses | The **Report** button on every visitor entry (spam, rude or abusive, off topic, other). Three reports from different people hide the entry until you review it (`report_hide_at`). You see it in the admin page's **Reported** list. **Put it back** (a hidden entry), **Keep it** (a public one) or reject it. The triage skill handles reported entries too. |
| The ability to block abusive users | **Block author** on the admin page (also `arghbox_block_author` over MCP, and `block_author` in triage). A blocked author's new posts are rejected quietly and their reports are ignored. A block lasts `block_days` (90 by default), and you can lift it. |
| Published contact information | Set `contact_url` in `config.php` (an `https://` link or a `mailto:` address). The board shows it as **Contact** in the footer. |

Also add to your store listing: where the board is, and how fast you act on reports. Answer reports on the same day if you can. Review of the store text is up to the store, not ArghBox, and these rules change, so check the current guidelines before each submission.

## Testing on a real phone

1. Put the site (with ArghBox installed) on a real https address. Turnstile checks the host name against `site_url`, so a plain `http://192.168...` address does not work.
2. Open `https://your-site/arghbox/app.html?platform=ios&version=1.0.0` in the phone's own browser first. If the board works there, a WebView problem is in your app, not in ArghBox.
3. Run your app on the phone (not a simulator, when you can) and open the screen. Add an entry and vote. Check that it shows on the admin page under Pending, with the line "App: iOS 1.0.0".
4. Close the screen from the board's close button. Your app must get the `close` message, or the `arghbox://close` address. Tap **Contact** (when `contact_url` is set): your app must open it in the system browser or mail app (the `link` message).
5. Close and open the app again. The votes you made must still show (the voter key is kept).
6. Report a published entry from the board. Reports are counted by network address, so to see the auto-hide with one phone, set `'report_hide_at' => 1` in a test setup. The entry then leaves the board and shows up under **Pending** and **Reported**, marked "Hidden after reports". Try **Put it back (dismiss reports)** on it, **Keep it (dismiss reports)** on a reported entry that is still public, and **Block author** and **Unblock author** on the admin page.

Questions and ideas about mobile apps go to the Feedback box on [arghbox.com](https://arghbox.com). Bugs go to [GitHub issues](https://github.com/BinaryBananaLLC/ArghBox/issues).

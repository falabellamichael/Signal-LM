package com.signallm.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int DIR_CHOOSER_REQUEST = 1002;
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        webView.addJavascriptInterface(new LmStudioLiteHttpBridge(this), "lmStudioLiteNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Inject JavaScript wrappers to make the bridge methods return Promises
                String js = "if (window.lmStudioLiteNative) {\n" +
                        "  window.lmStudioLiteNative.selectFolder = function() {\n" +
                        "    return new Promise(function(resolve, reject) {\n" +
                        "      window.__selectFolderResolve = resolve;\n" +
                        "      window.__selectFolderReject = reject;\n" +
                        "      window.lmStudioLiteNative.triggerSelectFolder();\n" +
                        "    });\n" +
                        "  };\n" +
                        "  window.lmStudioLiteNative.getPersistedWorkspace = function() {\n" +
                        "    return new Promise(function(resolve, reject) {\n" +
                        "      window.__getPersistedWorkspaceResolve = resolve;\n" +
                        "      window.__getPersistedWorkspaceReject = reject;\n" +
                        "      window.lmStudioLiteNative.triggerGetPersistedWorkspace();\n" +
                        "    });\n" +
                        "  };\n" +
                        "  window.lmStudioLiteNative.writeFiles = function(edits) {\n" +
                        "    var json = typeof edits === 'string' ? edits : JSON.stringify(edits);\n" +
                        "    return new Promise(function(resolve, reject) {\n" +
                        "      window.__writeFilesResolve = resolve;\n" +
                        "      window.__writeFilesReject = reject;\n" +
                        "      window.lmStudioLiteNative.triggerWriteFiles(json);\n" +
                        "    });\n" +
                        "  };\n" +
                        "  window.lmStudioLiteNative.writeFile = function(path, content) {\n" +
                        "    return new Promise(function(resolve, reject) {\n" +
                        "      window.__writeFileResolve = resolve;\n" +
                        "      window.__writeFileReject = reject;\n" +
                        "      window.lmStudioLiteNative.triggerWriteFile(path, content);\n" +
                        "    });\n" +
                        "  };\n" +
                        "  window.lmStudioLiteNative.readFile = function(path) {\n" +
                        "    return new Promise(function(resolve, reject) {\n" +
                        "      window.__readFileResolve = resolve;\n" +
                        "      window.__readFileReject = reject;\n" +
                        "      window.lmStudioLiteNative.triggerReadFile(path);\n" +
                        "    });\n" +
                        "  };\n" +
                        "  window.lmStudioLiteNative.clearPersistedWorkspace = function() {\n" +
                        "    return new Promise(function(resolve, reject) {\n" +
                        "      window.__clearPersistedWorkspaceResolve = resolve;\n" +
                        "      window.lmStudioLiteNative.triggerClearPersistedWorkspace();\n" +
                        "    });\n" +
                        "  };\n" +
                        "  window.lmStudioLiteNative.httpRequest = function(payload) {\n" +
                        "    var json = typeof payload === 'string' ? payload : JSON.stringify(payload || {});\n" +
                        "    return new Promise(function(resolve, reject) {\n" +
                        "      var requestId = 'req_' + Math.random().toString(36).slice(2);\n" +
                        "      window['__httpResolve_' + requestId] = resolve;\n" +
                        "      window['__httpReject_' + requestId] = reject;\n" +
                        "      window.lmStudioLiteNative.triggerHttpRequest(json, requestId);\n" +
                        "    });\n" +
                        "  };\n" +
                        "  window.lmStudioLiteNative.request = window.lmStudioLiteNative.httpRequest;\n" +
                        "  window.lmStudioLiteNative.fetchJson = window.lmStudioLiteNative.httpRequest;\n" +
                        "}";
                view.evaluateJavascript(js, null);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;
                Intent intent;
                try {
                    intent = fileChooserParams.createIntent();
                } catch (Exception error) {
                    MainActivity.this.filePathCallback = null;
                    return false;
                }
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException error) {
                    MainActivity.this.filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (savedInstanceState == null) {
            webView.loadUrl("file:///android_asset/index.html");
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    public void evaluateJavascript(final String script) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) {
                    webView.evaluateJavascript(script, null);
                }
            }
        });
    }

    public void launchFolderPicker() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(intent, DIR_CHOOSER_REQUEST);
        } catch (Exception e) {
            evaluateJavascript("if (window.__selectFolderReject) window.__selectFolderReject('Picker failed: " + e.getMessage() + "');");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && filePathCallback != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            filePathCallback.onReceiveValue(result);
            filePathCallback = null;
        } else if (requestCode == DIR_CHOOSER_REQUEST) {
            if (resultCode == RESULT_OK && data != null) {
                Uri treeUri = data.getData();
                if (treeUri != null) {
                    try {
                        int takeFlags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                        getContentResolver().takePersistableUriPermission(treeUri, takeFlags);
                    } catch (Exception e) {
                        // ignore or log
                    }

                    getSharedPreferences("signallm_prefs", MODE_PRIVATE)
                            .edit()
                            .putString("persisted_tree_uri", treeUri.toString())
                            .apply();

                    scanAndReturnWorkspace(treeUri, true);
                } else {
                    evaluateJavascript("if (window.__selectFolderReject) window.__selectFolderReject('No folder selected');");
                }
            } else {
                evaluateJavascript("if (window.__selectFolderReject) window.__selectFolderReject('User cancelled directory selection');");
            }
        }
    }

    public void loadPersistedWorkspace() {
        String persistedUriStr = getSharedPreferences("signallm_prefs", MODE_PRIVATE)
                .getString("persisted_tree_uri", null);
        if (persistedUriStr == null) {
            evaluateJavascript("if (window.__getPersistedWorkspaceResolve) window.__getPersistedWorkspaceResolve(null);");
            return;
        }
        Uri treeUri = Uri.parse(persistedUriStr);

        boolean hasPermission = false;
        for (UriPermission permission : getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(treeUri)) {
                hasPermission = true;
                break;
            }
        }

        if (hasPermission) {
            scanAndReturnWorkspace(treeUri, false);
        } else {
            evaluateJavascript("if (window.__getPersistedWorkspaceResolve) window.__getPersistedWorkspaceResolve(null);");
        }
    }

    public void clearPersistedWorkspace() {
        getSharedPreferences("signallm_prefs", MODE_PRIVATE)
                .edit()
                .remove("persisted_tree_uri")
                .apply();
        evaluateJavascript("if (window.__clearPersistedWorkspaceResolve) window.__clearPersistedWorkspaceResolve(true);");
    }

    public void scanAndReturnWorkspace(final Uri treeUri, final boolean isSelectFolderCallback) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Set<String> skipDirs = new HashSet<>(Arrays.asList(".git", "node_modules", "dist", "build", ".next", ".cache", "vendor"));
                    Set<String> compExts = new HashSet<>(Arrays.asList(
                            ".txt", ".md", ".markdown", ".csv", ".log", ".html", ".htm", ".css", ".js", ".mjs", ".json", ".xml",
                            ".yml", ".yaml", ".py", ".ts", ".tsx", ".jsx", ".php", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h",
                            ".hpp", ".cs", ".swift", ".sql", ".sh", ".zsh", ".bash", ".env", ".gitignore"
                    ));

                    JSONArray filesArray = new JSONArray();
                    scanDirectoryUri(treeUri, treeUri, "", filesArray, skipDirs, compExts);

                    String folderName = "Documents";
                    try {
                        String docId = DocumentsContract.getTreeDocumentId(treeUri);
                        Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
                        Cursor cursor = getContentResolver().query(documentUri, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null);
                        if (cursor != null) {
                            if (cursor.moveToFirst()) {
                                folderName = cursor.getString(0);
                            }
                            cursor.close();
                        }
                    } catch (Exception e) {
                        // ignore, use fallback
                    }

                    JSONObject workspace = new JSONObject();
                    workspace.put("name", folderName);
                    workspace.put("writable", true);
                    workspace.put("files", filesArray);

                    String jsonStr = workspace.toString();
                    String escapedJson = JSONObject.quote(jsonStr);

                    if (isSelectFolderCallback) {
                        evaluateJavascript("if (window.__selectFolderResolve) window.__selectFolderResolve(" + escapedJson + ");");
                    } else {
                        evaluateJavascript("if (window.__getPersistedWorkspaceResolve) window.__getPersistedWorkspaceResolve(" + escapedJson + ");");
                    }
                } catch (Exception e) {
                    String errMsg = JSONObject.quote("Folder scan failed: " + e.getMessage());
                    if (isSelectFolderCallback) {
                        evaluateJavascript("if (window.__selectFolderReject) window.__selectFolderReject(" + errMsg + ");");
                    } else {
                        evaluateJavascript("if (window.__getPersistedWorkspaceReject) window.__getPersistedWorkspaceReject(" + errMsg + ");");
                    }
                }
            }
        }).start();
    }

    private void scanDirectoryUri(Uri treeUri, Uri dirUri, String relativePath, JSONArray filesArray, Set<String> skipDirs, Set<String> compExts) {
        if (filesArray.length() >= 220) return;

        ContentResolver resolver = getContentResolver();
        Uri childrenUri;
        if (dirUri.equals(treeUri)) {
            String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
            childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, rootDocId);
        } else {
            String docId = DocumentsContract.getDocumentId(dirUri);
            childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
        }

        Cursor cursor = null;
        try {
            cursor = resolver.query(childrenUri, new String[] {
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED
            }, null, null, null);

            if (cursor != null) {
                List<Bundle> children = new ArrayList<>();
                while (cursor.moveToNext()) {
                    Bundle child = new Bundle();
                    child.putString("id", cursor.getString(0));
                    child.putString("name", cursor.getString(1));
                    child.putString("mime", cursor.getString(2));
                    child.putLong("size", cursor.getLong(3));
                    child.putLong("lastModified", cursor.getLong(4));
                    children.add(child);
                }
                cursor.close();
                cursor = null;

                for (Bundle child : children) {
                    if (filesArray.length() >= 220) break;

                    String id = child.getString("id");
                    String name = child.getString("name");
                    String mime = child.getString("mime");
                    long size = child.getLong("size");
                    long lastModified = child.getLong("lastModified");

                    String childPath = relativePath.isEmpty() ? name : relativePath + "/" + name;

                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                        if (skipDirs.contains(name)) continue;
                        Uri childDirUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
                        scanDirectoryUri(treeUri, childDirUri, childPath, filesArray, skipDirs, compExts);
                    } else {
                        String ext = "";
                        int dot = name.lastIndexOf('.');
                        if (dot >= 0) {
                            ext = name.substring(dot).toLowerCase();
                        } else if (name.startsWith(".")) {
                            ext = name.toLowerCase();
                        }
                        if (compExts.contains(ext) && size <= 2 * 1024 * 1024) {
                            JSONObject fileObj = new JSONObject();
                            fileObj.put("path", childPath);
                            fileObj.put("name", name);
                            fileObj.put("size", size);
                            fileObj.put("lastModified", lastModified);
                            // Do not read content during scan to avoid memory issues and giant JSON payloads.
                            // The JS side will call readFile(path) when it actually needs the content.
                            filesArray.put(fileObj);
                        }
                    }
                }
            }
        } catch (Exception e) {
            // ignore
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    public void readFileFromWorkspace(final String path) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                String persistedUriStr = getSharedPreferences("signallm_prefs", MODE_PRIVATE)
                        .getString("persisted_tree_uri", null);
                if (persistedUriStr == null) {
                    evaluateJavascript("if (window.__readFileReject) window.__readFileReject('No workspace folder selected');");
                    return;
                }
                Uri treeUri = Uri.parse(persistedUriStr);
                Uri fileUri = getFileUriForPath(treeUri, path, false, null);
                if (fileUri == null) {
                    evaluateJavascript("if (window.__readFileReject) window.__readFileReject('File not found: " + path + "');");
                    return;
                }
                String content = readFileContent(fileUri);
                String escapedContent = JSONObject.quote(content);
                evaluateJavascript("if (window.__readFileResolve) window.__readFileResolve(" + escapedContent + ");");
            }
        }).start();
    }

    public void writeFileToWorkspace(final String path, final String content) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                String persistedUriStr = getSharedPreferences("signallm_prefs", MODE_PRIVATE)
                        .getString("persisted_tree_uri", null);
                if (persistedUriStr == null) {
                    evaluateJavascript("if (window.__writeFileReject) window.__writeFileReject('No workspace folder selected');");
                    return;
                }
                Uri treeUri = Uri.parse(persistedUriStr);

                try {
                    Uri fileUri = getFileUriForPath(treeUri, path, true, "text/plain");
                    if (fileUri != null && writeFileContent(fileUri, content)) {
                        evaluateJavascript("if (window.__writeFileResolve) window.__writeFileResolve(true);");
                    } else {
                        evaluateJavascript("if (window.__writeFileReject) window.__writeFileReject('Could not write to file: " + path + "');");
                    }
                } catch (Exception e) {
                    evaluateJavascript("if (window.__writeFileReject) window.__writeFileReject('Write failed: " + JSONObject.quote(e.getMessage()) + "');");
                }
            }
        }).start();
    }

    public void writeFilesToWorkspace(final String jsonEdits) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                String persistedUriStr = getSharedPreferences("signallm_prefs", MODE_PRIVATE)
                        .getString("persisted_tree_uri", null);
                if (persistedUriStr == null) {
                    evaluateJavascript("if (window.__writeFilesReject) window.__writeFilesReject('No workspace folder selected');");
                    return;
                }
                Uri treeUri = Uri.parse(persistedUriStr);

                try {
                    JSONArray filesArray = null;
                    if (jsonEdits.trim().startsWith("[")) {
                        filesArray = new JSONArray(jsonEdits);
                    } else {
                        JSONObject obj = new JSONObject(jsonEdits);
                        filesArray = obj.optJSONArray("files");
                    }

                    if (filesArray == null) {
                        evaluateJavascript("if (window.__writeFilesReject) window.__writeFilesReject('Invalid write files format');");
                        return;
                    }

                    int count = 0;
                    for (int i = 0; i < filesArray.length(); i++) {
                        JSONObject fileObj = filesArray.getJSONObject(i);
                        String path = fileObj.getString("path");
                        String content = fileObj.getString("content");

                        Uri fileUri = getFileUriForPath(treeUri, path, true, "text/plain");
                        if (fileUri != null) {
                            if (writeFileContent(fileUri, content)) {
                                count++;
                            }
                        }
                    }

                    evaluateJavascript("if (window.__writeFilesResolve) window.__writeFilesResolve(" + count + ");");
                } catch (Exception e) {
                    evaluateJavascript("if (window.__writeFilesReject) window.__writeFilesReject('Write failed: " + JSONObject.quote(e.getMessage()) + "');");
                }
            }
        }).start();
    }

    public void resolveHttpRequest(String requestId, String result) {
        String escaped = JSONObject.quote(result);
        evaluateJavascript("if (window['__httpResolve_" + requestId + "']) window['__httpResolve_" + requestId + "'](" + escaped + ");");
    }

    private Uri getFileUriForPath(Uri treeUri, String relativePath, boolean createIfMissing, String mimeType) {
        ContentResolver resolver = getContentResolver();
        String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
        String[] parts = relativePath.split("/");
        String currentDocId = rootDocId;

        for (int i = 0; i < parts.length; i++) {
            String part = parts[i];
            if (part.isEmpty()) continue;

            boolean isLast = (i == parts.length - 1);
            String foundDocId = null;

            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, currentDocId);
            Cursor cursor = null;
            try {
                cursor = resolver.query(childrenUri, new String[] {
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME
                }, null, null, null);
                if (cursor != null) {
                    while (cursor.moveToNext()) {
                        String docId = cursor.getString(0);
                        String name = cursor.getString(1);
                        if (part.equals(name)) {
                            foundDocId = docId;
                            break;
                        }
                    }
                }
            } catch (Exception e) {
                // ignore
            } finally {
                if (cursor != null) cursor.close();
            }

            if (foundDocId == null) {
                if (createIfMissing) {
                    try {
                        Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, currentDocId);
                        String childMime = isLast ? mimeType : DocumentsContract.Document.MIME_TYPE_DIR;
                        Uri newDocUri = DocumentsContract.createDocument(resolver, parentUri, childMime, part);
                        if (newDocUri != null) {
                            foundDocId = DocumentsContract.getDocumentId(newDocUri);
                        } else {
                            return null;
                        }
                    } catch (Exception e) {
                        return null;
                    }
                } else {
                    return null;
                }
            }

            currentDocId = foundDocId;
        }

        return DocumentsContract.buildDocumentUriUsingTree(treeUri, currentDocId);
    }

    private String readFileContent(Uri fileUri) {
        try {
            InputStream is = getContentResolver().openInputStream(fileUri);
            if (is == null) return "";
            BufferedReader br = new BufferedReader(new InputStreamReader(is, "UTF-8"));
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[4096];
            int read;
            while ((read = br.read(buf)) != -1) {
                sb.append(buf, 0, read);
            }
            br.close();
            is.close();
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private boolean writeFileContent(Uri fileUri, String content) {
        try {
            OutputStream os = getContentResolver().openOutputStream(fileUri, "wt");
            if (os == null) return false;
            BufferedWriter bw = new BufferedWriter(new OutputStreamWriter(os, "UTF-8"));
            bw.write(content);
            bw.flush();
            bw.close();
            os.close();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}


package com.radiaviewer.app.storage;

import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "RadiaStorage")
public class RadiaStoragePlugin extends Plugin {
    private static final int BUFFER_SIZE = 1024 * 1024;

    @PluginMethod
    public void copyFromUri(PluginCall call) {
        String sourceUri = call.getString("sourceUri");
        String targetPath = call.getString("targetPath");

        if (sourceUri == null || sourceUri.isEmpty()) {
            call.reject("sourceUri is required");
            return;
        }

        if (targetPath == null || targetPath.isEmpty()) {
            call.reject("targetPath is required");
            return;
        }

        try {
            Uri uri = Uri.parse(sourceUri);
            File baseDir = getContext().getExternalFilesDir(null);
            if (baseDir == null) {
                call.reject("External files directory is not available");
                return;
            }

            File targetFile = new File(baseDir, targetPath);
            File parent = targetFile.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                call.reject("Failed to create target directory");
                return;
            }

            try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                 BufferedInputStream bufferedInput = new BufferedInputStream(input, BUFFER_SIZE);
                 BufferedOutputStream bufferedOutput = new BufferedOutputStream(new FileOutputStream(targetFile), BUFFER_SIZE)) {

                if (input == null) {
                    call.reject("Unable to open input stream");
                    return;
                }

                byte[] buffer = new byte[BUFFER_SIZE];
                int count;
                while ((count = bufferedInput.read(buffer)) != -1) {
                    bufferedOutput.write(buffer, 0, count);
                }
                bufferedOutput.flush();
            }

            JSObject result = new JSObject();
            result.put("path", targetFile.getAbsolutePath());
            result.put("uri", Uri.fromFile(targetFile).toString());
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Failed to copy file: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void getFileUri(PluginCall call) {
        String targetPath = call.getString("targetPath");
        if (targetPath == null || targetPath.isEmpty()) {
            call.reject("targetPath is required");
            return;
        }

        File baseDir = getContext().getExternalFilesDir(null);
        if (baseDir == null) {
            call.reject("External files directory is not available");
            return;
        }

        File targetFile = new File(baseDir, targetPath);
        JSObject result = new JSObject();
        result.put("path", targetFile.getAbsolutePath());
        result.put("uri", Uri.fromFile(targetFile).toString());
        result.put("exists", targetFile.exists());
        call.resolve(result);
    }
}

package com.automanager.app;
 
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
 
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
 
import com.getcapacitor.BridgeActivity;
 
public class MainActivity extends BridgeActivity {
 
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
 
        // Android 15+ dibuja la app "de borde a borde" (debajo de la barra de estado, la cámara
        // y los botones de navegación). Acá le damos a la web un margen igual al de esas zonas.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
 
        final View root = findViewById(android.R.id.content);
        root.setBackgroundColor(Color.WHITE); // color que se ve detrás de las barras del sistema
 
        // Íconos oscuros en las barras (la app es clara)
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), root);
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
 
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            // Si el teclado está abierto, el margen inferior es el del teclado
            int bottom = Math.max(bars.bottom, ime.bottom);
            v.setPadding(bars.left, bars.top, bars.right, bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }
}
 
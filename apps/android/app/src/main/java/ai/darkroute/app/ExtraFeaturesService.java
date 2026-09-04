package ai.darkroute.app;

import com.google.androidbrowserhelper.locationdelegation.LocationDelegationExtraCommandHandler;
import com.google.androidbrowserhelper.trusted.DelegationService;

/**
 * The whole native surface of this app.
 *
 * Registering {@link LocationDelegationExtraCommandHandler} is what makes the
 * web app's ordinary {@code navigator.geolocation} calls resolve through
 * Android's location permission and the fused provider, rather than through
 * Chrome's per-site permission. That is the difference between an alert that
 * survives the screen locking and one that does not, and it is the only reason
 * this Android project exists at all — everything else here is an icon, a
 * splash screen and a window without an address bar.
 *
 * There is deliberately no other native code. Every rule about what the app
 * may store, show or send lives in the web app, where it is testable and where
 * a reviewer can read it; duplicating any of it here would create a second
 * place for the answer to be different.
 */
public class ExtraFeaturesService extends DelegationService {
    public ExtraFeaturesService() {
        registerExtraCommandHandler(new LocationDelegationExtraCommandHandler());
    }
}

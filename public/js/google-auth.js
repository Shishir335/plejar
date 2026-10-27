/**
 * Plejar Google Identity Services (GIS) Web Authentication Helper
 * Integrates Google Sign-In with backend /api/v1/users/google-login
 */
(function (root) {
  let cachedClientId = null;
  let fetchingClientId = null;

  async function fetchGoogleClientId() {
    if (cachedClientId !== null) return cachedClientId;
    if (fetchingClientId) return fetchingClientId;

    fetchingClientId = (async () => {
      try {
        const res = await fetch('/api/v1/users/google-client-id');
        const json = await res.json();
        if (json && json.status === 'success' && json.data && json.data.clientId) {
          cachedClientId = json.data.clientId.trim();
        } else {
          cachedClientId = '';
        }
      } catch (err) {
        console.warn('[Plejar Google Auth] Failed to fetch client ID from server:', err);
        cachedClientId = '';
      } finally {
        fetchingClientId = null;
      }
      return cachedClientId;
    })();

    return fetchingClientId;
  }

  function waitForGIS(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      if (root.google && root.google.accounts && root.google.accounts.id) {
        return resolve(root.google.accounts.id);
      }
      const start = Date.now();
      const interval = setInterval(() => {
        if (root.google && root.google.accounts && root.google.accounts.id) {
          clearInterval(interval);
          resolve(root.google.accounts.id);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          reject(new Error('Google Identity Services SDK failed to load. Check your network connection.'));
        }
      }, 50);
    });
  }

  /**
   * Initializes and renders a Google Sign-In button into target element
   * @param {Object} options
   * @param {string|HTMLElement} options.target - ID or DOM element to render button in
   * @param {Function} options.onSuccess - Callback receiving { credential, select_by }
   * @param {Function} [options.onError] - Optional error callback
   * @param {string} [options.theme='outline'] - 'outline', 'filled_blue', 'filled_black'
   * @param {string} [options.text='continue_with'] - 'signin_with', 'signup_with', 'continue_with'
   * @param {string} [options.shape='rectangular'] - 'rectangular', 'pill', 'circle', 'square'
   * @param {number|string} [options.width=300] - Button width in px
   */
  async function renderButton(options = {}) {
    const {
      target,
      onSuccess,
      onError,
      theme = 'outline',
      text = 'continue_with',
      shape = 'rectangular',
      size = 'large',
      width = 280
    } = options;

    const container = typeof target === 'string' ? document.getElementById(target) : target;
    if (!container) return;

    try {
      const clientId = await fetchGoogleClientId();
      if (!clientId) {
        container.innerHTML = `
          <div class="google-auth-unconfigured" title="Set GOOGLE_CLIENT_ID in server configuration">
            <button type="button" class="btn-google-disabled" disabled>
              <svg class="google-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <span>Google Sign-In (Pending Setup)</span>
            </button>
            <p class="google-auth-hint">Server needs GOOGLE_CLIENT_ID from Firebase</p>
          </div>
        `;
        return;
      }

      const gis = await waitForGIS();

      gis.initialize({
        client_id: clientId,
        callback: response => {
          if (response && response.credential) {
            if (typeof onSuccess === 'function') onSuccess(response);
          } else if (typeof onError === 'function') {
            onError(new Error('Google did not return credentials.'));
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true
      });

      container.innerHTML = '';
      gis.renderButton(container, {
        theme,
        size,
        text,
        shape,
        width,
        logo_alignment: 'left'
      });
    } catch (err) {
      console.error('[Plejar Google Auth Error]:', err);
      if (typeof onError === 'function') onError(err);
      container.innerHTML = `<p class="google-auth-err">Could not load Google Sign-In: ${err.message}</p>`;
    }
  }

  /**
   * Post Google credential to the Plejar API
   * @param {string} credential - Google JWT ID token
   * @returns {Promise<{ ok: boolean, data: any, status: number }>}
   */
  async function loginWithGoogleCredential(credential) {
    try {
      const res = await fetch('/api/v1/users/google-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credential })
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data, status: res.status };
    } catch (err) {
      return { ok: false, data: { message: err.message || 'Network error while contacting server.' }, status: 0 };
    }
  }

  root.PlejarGoogleAuth = {
    fetchGoogleClientId,
    renderButton,
    loginWithGoogleCredential
  };
  root.PlezarGoogleAuth = root.PlejarGoogleAuth;
})(window);

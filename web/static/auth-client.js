(() => {
    const state = {
        csrfToken: null,
    };

    async function ensureCsrfToken() {
        if (state.csrfToken) {
            return state.csrfToken;
        }

        const response = await fetch('/api/auth/me', {
            credentials: 'include',
        });

        if (response.status === 401) {
            window.location.href = '/login';
            throw new Error('Unauthorized');
        }

        const csrfToken = response.headers.get('X-CSRF-Token');
        if (csrfToken) {
            state.csrfToken = csrfToken;
        }
        return state.csrfToken;
    }

    async function checkAuth(options = {}) {
        const {
            usernameElementId = 'username',
            fallbackUsername = 'Аудитор',
            redirectToLogin = true,
        } = options;

        const response = await fetch('/api/auth/me', {
            credentials: 'include',
        });

        if (response.status === 401) {
            if (redirectToLogin) {
                window.location.href = '/login';
            }
            throw new Error('Unauthorized');
        }

        if (!response.ok) {
            throw new Error(`Auth check failed: ${response.status}`);
        }

        const user = await response.json();
        const newToken = response.headers.get('X-CSRF-Token');
        if (newToken) {
            state.csrfToken = newToken;
        } else if (user.csrf_token) {
            state.csrfToken = user.csrf_token;
        }

        const usernameEl = document.getElementById(usernameElementId);
        if (usernameEl) {
            usernameEl.textContent = user.username || fallbackUsername;
        }

        return user;
    }

    async function authenticatedFetch(url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        const headers = {
            ...options.headers,
        };

        if (method !== 'GET' && method !== 'HEAD') {
            const csrfToken = await ensureCsrfToken();
            if (csrfToken) {
                headers['X-CSRF-Token'] = csrfToken;
            }
        }

        if (!headers['Content-Type'] && method !== 'GET' && method !== 'HEAD') {
            headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(url, {
            ...options,
            credentials: 'include',
            headers,
        });

        const newToken = response.headers.get('X-CSRF-Token');
        if (newToken) {
            state.csrfToken = newToken;
        }

        if (response.status === 401) {
            window.location.href = '/login';
            throw new Error('Unauthorized');
        }

        return response;
    }

    window.AuthClient = {
        authenticatedFetch,
        checkAuth,
        getCsrfToken: () => state.csrfToken,
        setCsrfToken: (token) => {
            state.csrfToken = token;
        },
    };
})();

import { Issuer, custom, generators } from 'openid-client';

// openid-client's default HTTP timeout is 3.5 s; allow for slower links to Microsoft.
custom.setHttpOptionsDefaults({ timeout: 15000 });

/**
 * Microsoft Entra ID (OpenID Connect) client for the authorisation-code flow with PKCE.
 *
 * openid-client validates the ID token's signature (against Entra's published keys),
 * issuer (which is tenant-specific, so other tenants are rejected), audience, expiry,
 * nonce and state.
 */
export function createEntraClient(entra) {
  let clientPromise;

  async function client() {
    if (!clientPromise) {
      clientPromise = Issuer.discover(`https://login.microsoftonline.com/${entra.tenantId}/v2.0`)
        .then(
          (issuer) =>
            new issuer.Client({
              client_id: entra.clientId,
              client_secret: entra.clientSecret,
              redirect_uris: [entra.redirectUri],
              response_types: ['code'],
              id_token_signed_response_alg: 'RS256',
            }),
        )
        .catch((err) => {
          clientPromise = undefined; // retry discovery next time
          throw err;
        });
    }
    return clientPromise;
  }

  return {
    /** Start sign-in. Returns the Microsoft URL plus the values to keep in the session. */
    async beginSignIn() {
      const c = await client();
      const state = generators.state();
      const nonce = generators.nonce();
      const codeVerifier = generators.codeVerifier();
      const url = c.authorizationUrl({
        scope: 'openid profile email',
        response_mode: 'query',
        state,
        nonce,
        code_challenge: generators.codeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return { url, checks: { state, nonce, codeVerifier } };
    },

    /** Complete sign-in from the callback request. Returns validated ID token claims. */
    async completeSignIn(req, checks) {
      const c = await client();
      const params = c.callbackParams(req);
      const tokenSet = await c.callback(entra.redirectUri, params, {
        state: checks.state,
        nonce: checks.nonce,
        code_verifier: checks.codeVerifier,
      });
      return tokenSet.claims();
    },

    /** Microsoft sign-out URL. */
    async signOutUrl(postLogoutRedirectUri) {
      const c = await client();
      return c.endSessionUrl({ post_logout_redirect_uri: postLogoutRedirectUri });
    },
  };
}

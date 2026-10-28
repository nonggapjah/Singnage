export interface User {
    username: string;
    fullName: string;
    role: string;
}

export interface LoginResponse {
    /**
     * Bearer token. An API of 2.8+ authenticates the admin console with the httpOnly `su_session`
     * cookie it sets on this response and should omit (or ignore) this field; an older API returns
     * it and the web keeps it only for the lifetime of the tab (see lib/api-fetch LEGACY_SESSION_KEY).
     */
    token?: string;
    /** 'cookie' when the API set `su_session`; absent on older APIs. */
    authMode?: 'cookie' | 'bearer';
    username: string;
    fullName: string;
    role: string;
    identifierType?: string; // e.g. 'email', 'phone', 'username'
}

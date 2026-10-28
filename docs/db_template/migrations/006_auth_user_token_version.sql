-- F12: bumped on password change, role change and deactivation. A JWT carries the version it was
-- issued with ("tv" claim); the API rejects tokens whose version is older than this value, so a
-- revoked session stops working within the cache window instead of at token expiry.
IF COL_LENGTH('dbo.sn_auth_user', 'token_version') IS NULL
    ALTER TABLE dbo.sn_auth_user ADD token_version INT NOT NULL
        CONSTRAINT DF_sn_auth_user_token_version DEFAULT 1;
GO

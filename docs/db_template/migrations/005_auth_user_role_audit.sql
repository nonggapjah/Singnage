-- F15: sp_auth_user_std UPDATE_ROLE writes created_by / updated_by on sn_auth_user_role but the
-- table template never declared them.
IF COL_LENGTH('dbo.sn_auth_user_role', 'created_by') IS NULL
    ALTER TABLE dbo.sn_auth_user_role ADD created_by BIGINT NULL;
GO
IF COL_LENGTH('dbo.sn_auth_user_role', 'updated_by') IS NULL
    ALTER TABLE dbo.sn_auth_user_role ADD updated_by BIGINT NULL;
GO

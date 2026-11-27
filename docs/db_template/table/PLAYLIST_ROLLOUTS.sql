USE [SignageUnicornDB]
GO

/****** Object:  Tables [dbo].[sn_playlist_rollouts] + [dbo].[sn_playlist_rollout_items]    Script Date: 2026-11-27 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- Branch-by-branch playlist rollout (API 2.8.14, 27-11-2026). "Deploy playlist" to many branches at
-- once used to assign every screen in the same second, so every branch downloaded together and all
-- of them finished late. A rollout keeps the operator's selection as one header row plus one item
-- row per screen; the first branch is assigned at once and PlaylistRolloutWorker releases the next
-- wave every wave_minutes, holding while the media egress queue is still busy. The rows ARE the
-- state: the browser can be closed and the API restarted, the worker simply resumes.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'sn_playlist_rollouts')
BEGIN
    CREATE TABLE [dbo].[sn_playlist_rollouts](
        [rollout_id]           [bigint] IDENTITY(1,1) NOT NULL,
        [playlist_id]          [bigint] NOT NULL,
        [playlist_uuid]        [nvarchar](36) NOT NULL,            -- the public id the API and the screens use
        [status]               [nvarchar](12) NOT NULL,            -- active | paused | done | cancelled
        [wave_minutes]         [int] NOT NULL,
        [start_date]           [datetime2](7) NULL,                -- the six schedule fields every item gets
        [end_date]             [datetime2](7) NULL,
        [start_time]           [nvarchar](5) NULL,
        [end_time]             [nvarchar](5) NULL,
        [days_of_week]         [nvarchar](20) NULL,
        [repeat_every_minutes] [int] NULL,
        [hold_note]            [nvarchar](200) NULL,               -- why the worker is not releasing the next wave right now
        [created_by]           [bigint] NULL,
        [created_at]           [datetime2](7) NOT NULL CONSTRAINT [DF_sn_playlist_rollouts_created_at] DEFAULT (SYSUTCDATETIME()),
        [updated_at]           [datetime2](7) NOT NULL CONSTRAINT [DF_sn_playlist_rollouts_updated_at] DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT [PK_sn_playlist_rollouts] PRIMARY KEY CLUSTERED ([rollout_id] ASC)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'sn_playlist_rollout_items')
BEGIN
    CREATE TABLE [dbo].[sn_playlist_rollout_items](
        [item_id]        [bigint] IDENTITY(1,1) NOT NULL,
        [rollout_id]     [bigint] NOT NULL,
        [device_id]      [bigint] NOT NULL,
        [branch_code]    [nvarchar](50) NOT NULL,                  -- 'UNASSIGNED' when the screen has none
        [wave_no]        [int] NOT NULL,                           -- 1 = released with the request
        [not_before_utc] [datetime2](7) NOT NULL,
        [claimed_utc]    [datetime2](7) NULL,                     -- lease: set on claim (5 min), cleared on failure; keeps request and worker off the same item
        [claim_token]    [uniqueidentifier] NULL,                 -- fencing: only the holder of the current token may record the outcome
        [applied_utc]    [datetime2](7) NULL,
        [attempts]       [int] NOT NULL CONSTRAINT [DF_sn_playlist_rollout_items_attempts] DEFAULT ((0)),
        [last_error]     [nvarchar](400) NULL,
        CONSTRAINT [PK_sn_playlist_rollout_items] PRIMARY KEY CLUSTERED ([item_id] ASC),
        CONSTRAINT [FK_sn_playlist_rollout_items_rollout] FOREIGN KEY ([rollout_id]) REFERENCES [dbo].[sn_playlist_rollouts]([rollout_id]) ON DELETE CASCADE
    );
END
GO

-- One active-or-paused rollout per playlist, enforced here and not only by the service's pre-check:
-- two overlapping requests (or a retry after a timeout) cannot both create one. The loser gets a
-- duplicate-key error that the API answers with 409.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_sn_playlist_rollouts_open_playlist'
               AND object_id = OBJECT_ID('dbo.sn_playlist_rollouts'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_sn_playlist_rollouts_open_playlist]
    ON [dbo].[sn_playlist_rollouts] ([playlist_id] ASC)
    WHERE [status] IN ('active', 'paused');
END
GO

-- The worker asks "which items are due" every 30 s: pending rows of active rollouts, by time.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sn_playlist_rollout_items_due'
               AND object_id = OBJECT_ID('dbo.sn_playlist_rollout_items'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_sn_playlist_rollout_items_due]
    ON [dbo].[sn_playlist_rollout_items] ([rollout_id] ASC, [applied_utc] ASC, [not_before_utc] ASC)
    INCLUDE ([wave_no], [attempts]);
END
GO

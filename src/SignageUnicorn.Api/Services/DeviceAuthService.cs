using System.Security.Cryptography;
using System.Text;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories.Interfaces;

namespace SignageUnicorn.Api.Services
{
    // How strictly device requests are checked (appsettings Security:DeviceAuth).
    //   Off       - never check (emergency switch only).
    //   IfIssued  - default. A device that has been issued a token must present it; a device that has
    //               not been issued one yet (every screen running a client older than this change) is
    //               still accepted. Lets the fleet be upgraded screen by screen.
    //   Required  - every device request must carry a valid token. Switch to this only once every
    //               screen reports client_protocol 2 (see DeviceDto.ClientProtocol).
    public enum DeviceAuthMode { Off, IfIssued, Required }

    public sealed class DeviceAuthResult
    {
        public bool Ok { get; init; }
        public string? Reason { get; init; }
        // The message the HTTP 401 body carries (DEVICE_TOKEN_INVALID or DEVICE_IDENTITY_CONFLICT).
        public string Message { get; init; } = DeviceAuthService.RejectMessage;
        public long? DeviceId { get; init; }
        public string? DeviceUuid { get; init; }
        public bool HasToken { get; init; }
        // Round 3 (R2): the row's token was cleared by an operator and the screen has not claimed a
        // new one yet. The heartbeat response then carries a RECLAIM_TOKEN pseudo-command.
        public bool TokenResetPending { get; init; }
        // Round 3 (#1): whether the hardware key the request carried names a live row. When it does
        // not, the procedure would fall into its MAC-adoption branch, which must be authorised first.
        public bool KeyKnown { get; set; }
        // True when exactly one live row was identified. Controllers then pass this canonical identity
        // to the stored procedures instead of the raw request pair (contract T3).
        public bool Resolved => DeviceId.HasValue;

        public static DeviceAuthResult Accept(DeviceAuthInfo? info) => new()
        {
            Ok = true, DeviceId = info?.DeviceId, DeviceUuid = info?.DeviceUuid, HasToken = !string.IsNullOrEmpty(info?.TokenHash),
            TokenResetPending = info != null && string.IsNullOrEmpty(info.TokenHash) && info.TokenResetAt.HasValue
        };
        public static DeviceAuthResult Reject(string reason, DeviceAuthInfo? info, string message = DeviceAuthService.RejectMessage) => new()
        {
            Ok = false, Reason = reason, Message = message, DeviceId = info?.DeviceId, DeviceUuid = info?.DeviceUuid, HasToken = !string.IsNullOrEmpty(info?.TokenHash)
        };
    }

    public enum ClaimStatus { Issued, Rotated, NotFound, EvidenceMismatch, AlreadyIssued, Unavailable, Race }

    public sealed class ClaimOutcome
    {
        public ClaimStatus Status { get; init; }
        public string? Token { get; init; }
        public DeviceAuthInfo? Info { get; init; }
    }

    // Round 3 (#1). What the heartbeat may do when the procedure would adopt a MAC-matching row.
    //   Allow  - no candidate, a token-less candidate (legacy behaviour), or the request proved the
    //            candidate's token (a reinstalled screen that kept its token).
    //   Block  - the candidate is token-protected and the request did not prove it: the procedure
    //            must NOT adopt (re-uuid, dequeue) it; the screen is treated as new instead.
    //   Reject - same, under Required mode: the request is refused outright.
    public enum MacAdoptionDecision { Allow, Block, Reject }

    // Contract item 1: per-device bearer secret. Before this, knowing a screen's numeric id -- which
    // appears in URLs, log lines and screenshot file names -- was enough to impersonate it: fake its
    // heartbeat, swallow its queued commands, forge its proof-of-play and overwrite its screenshot.
    // The token is random, stored only as a SHA-256 hash and compared in constant time. The hardware
    // uuid ("DeviceKey") is deliberately NOT the secret: it is an identifier the admin console displays.
    //
    // Round 2 (T1-T4): a token is issued only to a client that says it can store one, so a deployed
    // v2.7.x screen that re-registers never ends up with a token it does not know about; screens
    // obtain tokens through the claim endpoint which resolves ONLY the row they already are; and a
    // request whose two identifiers point at two different rows is refused rather than letting the
    // procedure "self-heal" onto a row the caller did not authenticate as.
    //
    // Round 3 (R3): every token write is a conditional update against the hash that was read, so two
    // concurrent claims can never both "succeed" and strand the loser with a token the row no longer
    // holds. (R2): an operator reset leaves a marker the heartbeat turns into a RECLAIM_TOKEN
    // pseudo-command, because under IfIssued a reset screen is otherwise accepted token-less forever
    // and never asks again. (#1): the procedure's MAC-based adoption of an existing row is authorised
    // here before the procedure runs.
    public sealed class DeviceAuthService
    {
        public const string HeaderName = "X-Device-Token";
        public const string CapabilityHeaderName = "X-Device-Token-Capable";
        public const string ProtocolHeaderName = "X-Client-Protocol";
        public const string RejectMessage = "DEVICE_TOKEN_INVALID";
        public const string ConflictMessage = "DEVICE_IDENTITY_CONFLICT";
        public const string ClaimMismatchMessage = "CLAIM_EVIDENCE_MISMATCH";
        public const string ClaimAlreadyIssuedMessage = "TOKEN_ALREADY_ISSUED";
        public const string RaceMessage = "TOKEN_RACE";
        // Round 3 (R2): heartbeat pseudo-command telling a protocol-2 client to claim a fresh token.
        public const string ReclaimCommand = "RECLAIM_TOKEN";
        // Ids of commands the controller injects (never rows in sn_device_commands); the ack endpoint
        // answers 200 for them instead of 404.
        public const string PseudoCommandPrefix = "PSEUDO-";

        private readonly IDeviceRepository _devices;
        private readonly ISystemLogRepository _log;
        private readonly DeviceAuthMode _mode;
        private readonly bool _reclaimOnRegister;

        public DeviceAuthService(IDeviceRepository devices, ISystemLogRepository log, IConfiguration configuration)
            : this(devices, log,
                   ParseMode(configuration["Security:DeviceAuth"]),
                   string.Equals(configuration["Security:DeviceTokenReclaimOnRegister"], "true", StringComparison.OrdinalIgnoreCase))
        {
        }

        // Used by tests; production wiring goes through the IConfiguration constructor.
        internal DeviceAuthService(IDeviceRepository devices, ISystemLogRepository log, DeviceAuthMode mode, bool reclaimOnRegister)
        {
            _devices = devices;
            _log = log;
            _mode = mode;
            // Escape hatch for fleets where a reinstalled screen (config wiped, token lost) must come
            // back without an operator resetting its token: a token-capable register call that proves
            // the hardware uuid may re-claim. OFF by default because it weakens the token to "whoever
            // knows the uuid" for that one call; the claim endpoint + reset-token is the primary path.
            _reclaimOnRegister = reclaimOnRegister;
        }

        internal static DeviceAuthMode ParseMode(string? raw)
            => Enum.TryParse<DeviceAuthMode>(raw ?? "IfIssued", ignoreCase: true, out var parsed) ? parsed : DeviceAuthMode.IfIssued;

        public DeviceAuthMode Mode => _mode;

        public static string GenerateToken()
        {
            var bytes = RandomNumberGenerator.GetBytes(32);
            return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        public static string Hash(string token)
        {
            var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
            return Convert.ToHexString(bytes).ToLowerInvariant();
        }

        internal static bool TokenMatches(string? presentedToken, string? storedHash)
        {
            if (string.IsNullOrEmpty(presentedToken) || string.IsNullOrEmpty(storedHash)) return false;
            var a = Encoding.ASCII.GetBytes(Hash(presentedToken));
            var b = Encoding.ASCII.GetBytes(storedHash.Trim().ToLowerInvariant());
            return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
        }

        // Contract T1: only a client that declares it can persist a token is given one. The JSON flag
        // and the header are equivalent; deployed v2.7.x clients send neither.
        public static bool IsTokenCapable(bool? bodyFlag, string? headerValue)
        {
            if (bodyFlag == true) return true;
            var h = (headerValue ?? string.Empty).Trim();
            return h == "1" || h.Equals("true", StringComparison.OrdinalIgnoreCase) || h.Equals("yes", StringComparison.OrdinalIgnoreCase);
        }

        // Contract T5: protocol 1 = legacy client, 2+ = lease/ack client. Header wins over the body field.
        public static int ParseProtocol(string? headerValue, int? bodyValue)
        {
            if (int.TryParse((headerValue ?? string.Empty).Trim(), out var h) && h >= 1) return h;
            if (bodyValue.HasValue && bodyValue.Value >= 1) return bodyValue.Value;
            return 1;
        }

        // Round 3 (R2). A reset row is accepted token-less under IfIssued, so the screen would never
        // see a 401 and never ask for a new token. Tell it explicitly -- but only a client that can
        // act on it (it presented a token it still holds, or it speaks protocol 2).
        public static bool ShouldRequestReclaim(bool tokenResetPending, string? presentedToken, int protocol)
            => tokenResetPending && (!string.IsNullOrEmpty(presentedToken) || protocol >= 2);

        public static bool IsPseudoCommandId(string? commandId)
            => !string.IsNullOrEmpty(commandId) && commandId.StartsWith(PseudoCommandPrefix, StringComparison.OrdinalIgnoreCase);

        public static string NewPseudoCommandId() => PseudoCommandPrefix + Guid.NewGuid().ToString("N");

        internal static string? NormalizeMac(string? mac)
        {
            if (string.IsNullOrWhiteSpace(mac)) return null;
            var sb = new StringBuilder(12);
            foreach (var ch in mac) if (Uri.IsHexDigit(ch)) sb.Append(char.ToUpperInvariant(ch));
            var s = sb.ToString();
            if (s.Length != 12 || s == "000000000000") return null;
            return s;
        }

        // Contract T2 evidence rule. The row's own hardware uuid is the strongest proof; the MAC is the
        // fallback that survives a client reinstall; a row that has neither cannot be verified at all
        // (very old registrations), so it is claimable by whoever knows its id -- the same exposure it
        // had before tokens existed, but only until its first claim.
        public static bool ClaimEvidenceMatches(string? rowUuid, string? rowMac, string? deviceKey, string? presentedMac)
        {
            var hasUuid = !string.IsNullOrWhiteSpace(rowUuid);
            if (hasUuid && !string.IsNullOrWhiteSpace(deviceKey)
                && string.Equals(rowUuid!.Trim(), deviceKey.Trim(), StringComparison.OrdinalIgnoreCase))
                return true;

            var storedMac = NormalizeMac(rowMac);
            var givenMac = NormalizeMac(presentedMac);
            if (storedMac != null && givenMac != null && storedMac == givenMac) return true;

            return !hasUuid && storedMac == null;
        }

        private async Task<DeviceAuthInfo?> LookupAsync(string identifier)
        {
            return await _devices.GetDeviceAuthInfoAsync(identifier, null);
        }

        // Round 3 (R3): the only way a token is ever written. The update succeeds only when the row
        // still holds the hash this call read (or none, when none was read); otherwise another
        // issuance won the race and the caller must NOT hand out the token it generated.
        private async Task<string> WriteTokenOrThrowAsync(long deviceId, string? expectedHash, string outcome, string? uuid, string? remoteIp)
        {
            var token = GenerateToken();
            if (!await _devices.TrySetDeviceTokenHashAsync(deviceId, expectedHash, Hash(token)))
            {
                await Audit("TOKEN_RACE", deviceId.ToString(), uuid, remoteIp, $"during {outcome}");
                throw new DeviceTokenRaceException();
            }
            await Audit(outcome, deviceId.ToString(), uuid, remoteIp);
            return token;
        }

        // Backwards-compatible single-identifier validation (ack, screenshot, logs).
        public Task<DeviceAuthResult> ValidateAsync(string? deviceId, string? deviceUuid, string? presentedToken, string? remoteIp)
            => ResolveAsync(deviceId, deviceUuid, presentedToken, remoteIp);

        // Contract T3. Resolves the ONE row a device request is about, then applies the token rule.
        // deviceId may be the numeric id or the uuid; deviceKey is the optional hardware uuid sent
        // alongside (heartbeat). When the two identify different rows and either row is token-protected
        // the request is refused (DEVICE_IDENTITY_CONFLICT): a valid token for screen A must never let
        // the procedure update or dequeue screen B. Two token-less rows keep the legacy self-healing
        // behaviour (the caller passes the raw pair through and the procedure merges identities).
        public async Task<DeviceAuthResult> ResolveAsync(string? deviceId, string? deviceKey, string? presentedToken, string? remoteIp)
        {
            if (_mode == DeviceAuthMode.Off) return Tag(DeviceAuthResult.Accept(null), keyKnown: true);

            DeviceAuthInfo? byId = null;
            DeviceAuthInfo? byKey = null;
            var keyIsId = !string.IsNullOrWhiteSpace(deviceKey)
                          && string.Equals(deviceKey.Trim(), deviceId?.Trim(), StringComparison.OrdinalIgnoreCase);
            try
            {
                if (!string.IsNullOrWhiteSpace(deviceId)) byId = await LookupAsync(deviceId.Trim());
                if (!string.IsNullOrWhiteSpace(deviceKey) && !keyIsId)
                    byKey = await LookupAsync(deviceKey.Trim());
            }
            catch (Exception ex)
            {
                // Typically migration 001 not applied yet (device_token_hash missing). Under IfIssued
                // the fleet must keep heart-beating, so this fails OPEN and says so loudly; under
                // Required nothing can be verified, so it fails closed.
                Console.WriteLine($"[DeviceAuth] LOOKUP_FAILED | device={deviceId ?? "-"} | {ex.Message}");
                if (_mode == DeviceAuthMode.Required) return DeviceAuthResult.Reject("token lookup failed", null);
                return Tag(DeviceAuthResult.Accept(null), keyKnown: true);
            }

            // Does the hardware key name a live row? (#1: when it does not, the procedure would adopt a
            // MAC-matching row -- the controller asks AuthorizeMacAdoptionAsync first.)
            var keyKnown = string.IsNullOrWhiteSpace(deviceKey)
                           || byKey != null
                           || (byId != null && string.Equals(byId.DeviceUuid?.Trim(), deviceKey!.Trim(), StringComparison.OrdinalIgnoreCase));

            if (byId != null && byKey != null && byId.DeviceId != byKey.DeviceId)
            {
                // The presented token proves exactly one row: that row is the canonical identity and
                // the other identifier is ignored (the controller passes only the canonical pair on,
                // so the other row is never touched). A screen whose stored id and hardware key have
                // drifted apart therefore keeps working as the row it holds the token for.
                if (TokenMatches(presentedToken, byId.TokenHash)) return Tag(DeviceAuthResult.Accept(byId), keyKnown);
                if (TokenMatches(presentedToken, byKey.TokenHash)) return Tag(DeviceAuthResult.Accept(byKey), keyKnown);

                var anyToken = !string.IsNullOrEmpty(byId.TokenHash) || !string.IsNullOrEmpty(byKey.TokenHash);
                if (anyToken || _mode == DeviceAuthMode.Required)
                {
                    await Audit("REJECT_IDENTITY_CONFLICT", deviceId, deviceKey, remoteIp,
                        $"id row={byId.DeviceId} key row={byKey.DeviceId}");
                    return DeviceAuthResult.Reject("identity conflict", null, ConflictMessage);
                }
                // Legacy, token-less screens with drifted identity: let the procedure reconcile.
                return Tag(DeviceAuthResult.Accept(null), keyKnown);
            }

            // Same precedence as sp_device_std: the hardware uuid wins over a possibly stale numeric id.
            var info = byKey ?? byId;

            if (info == null)
            {
                // Unknown device. The heartbeat path auto-recovers unknown screens (creates a row), and
                // under IfIssued that legacy behaviour must keep working. Under Required an unknown
                // device has no token by definition and is refused.
                if (_mode == DeviceAuthMode.Required)
                {
                    await Audit("REJECT_UNKNOWN", deviceId, deviceKey, remoteIp);
                    return DeviceAuthResult.Reject("unknown device", null);
                }
                return Tag(DeviceAuthResult.Accept(null), keyKnown);
            }

            if (string.IsNullOrEmpty(info.TokenHash))
            {
                if (_mode == DeviceAuthMode.Required)
                {
                    await Audit("REJECT_NO_TOKEN", deviceId, deviceKey, remoteIp);
                    return DeviceAuthResult.Reject("device has no token", info);
                }
                return Tag(DeviceAuthResult.Accept(info), keyKnown);
            }

            if (TokenMatches(presentedToken, info.TokenHash)) return Tag(DeviceAuthResult.Accept(info), keyKnown);

            await Audit(string.IsNullOrEmpty(presentedToken) ? "REJECT_MISSING" : "REJECT_MISMATCH", deviceId, deviceKey, remoteIp);
            return DeviceAuthResult.Reject("token mismatch", info);
        }

        private static DeviceAuthResult Tag(DeviceAuthResult r, bool keyKnown)
        {
            r.KeyKnown = keyKnown;
            return r;
        }

        // Round 3 (#1). Called by the heartbeat when the hardware key is unknown and a MAC was sent:
        // sp_device_std would then adopt the one live row carrying that MAC (re-point its uuid, update
        // it, dequeue its commands). That is the legitimate "same screen, reinstalled client" path for
        // legacy rows, but for a token-protected row it is an unauthenticated takeover by anyone who
        // learns a MAC. The procedure is told not to adopt unless the request proved the candidate's
        // token.
        public async Task<MacAdoptionDecision> AuthorizeMacAdoptionAsync(string? deviceKey, string? macAddress, string? presentedToken, string? remoteIp)
        {
            if (_mode == DeviceAuthMode.Off) return MacAdoptionDecision.Allow;
            if (string.IsNullOrWhiteSpace(macAddress) || string.IsNullOrWhiteSpace(deviceKey)) return MacAdoptionDecision.Allow;

            DeviceAuthInfo? candidate;
            try
            {
                candidate = await _devices.GetDeviceAuthInfoByMacAsync(macAddress.Trim(), deviceKey.Trim());
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[DeviceAuth] MAC_LOOKUP_FAILED | key={deviceKey} | {ex.Message}");
                return _mode == DeviceAuthMode.Required ? MacAdoptionDecision.Reject : MacAdoptionDecision.Allow;
            }

            if (candidate == null) return MacAdoptionDecision.Allow;              // nothing to adopt
            if (string.IsNullOrEmpty(candidate.TokenHash)) return MacAdoptionDecision.Allow; // legacy row
            if (TokenMatches(presentedToken, candidate.TokenHash)) return MacAdoptionDecision.Allow;

            await Audit("ADOPTION_BLOCKED", candidate.DeviceId.ToString(), deviceKey, remoteIp,
                $"mac-matching row {candidate.DeviceId} is token-protected and the request did not prove it");
            return _mode == DeviceAuthMode.Required ? MacAdoptionDecision.Reject : MacAdoptionDecision.Block;
        }

        // Contract T4: called BEFORE RegisterOrLogin mutates anything. A register that names a row
        // which already holds a token must present that token; otherwise the row is left untouched
        // and the caller answers 401. Unknown keys (brand-new screens) pass: enrollment is how a new
        // screen gets its first token.
        public async Task PreAuthorizeRegisterAsync(string? deviceKey, string? presentedToken, string? remoteIp)
        {
            if (_mode == DeviceAuthMode.Off || string.IsNullOrWhiteSpace(deviceKey)) return;

            DeviceAuthInfo? info;
            try
            {
                info = await LookupAsync(deviceKey.Trim());
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[DeviceAuth] REGISTER_LOOKUP_FAILED | key={deviceKey} | {ex.Message}");
                if (_mode == DeviceAuthMode.Required) throw new DeviceAuthRejectedException();
                return;
            }

            if (info == null || string.IsNullOrEmpty(info.TokenHash)) return;
            if (TokenMatches(presentedToken, info.TokenHash)) return;

            await Audit("REJECT_REGISTER", info.DeviceId.ToString(), deviceKey, remoteIp);
            throw new DeviceAuthRejectedException();
        }

        // Called after a successful register/login. Returns the plaintext token when one was issued or
        // rotated (the only moment it ever exists in clear), null when the response must not carry one.
        // Contract T1: nothing is issued unless the client declared token capability.
        // Throws DeviceTokenRaceException (R3) when another issuance changed the row meanwhile.
        public async Task<string?> IssueOrRotateAsync(DeviceDto device, string? presentedToken, bool tokenCapable, string? remoteIp)
        {
            if (_mode == DeviceAuthMode.Off) return null;
            if (!long.TryParse(device.DeviceId, out var numericId)) return null;

            DeviceAuthInfo? info;
            try
            {
                info = await _devices.GetDeviceAuthInfoAsync(device.DeviceId, device.DeviceUuid);
            }
            catch (Exception ex)
            {
                // Same fail-open reasoning as ResolveAsync: without the column no token can be stored.
                Console.WriteLine($"[DeviceAuth] ISSUE_SKIPPED | device={device.DeviceId} | {ex.Message}");
                if (_mode == DeviceAuthMode.Required) throw new DeviceAuthRejectedException();
                return null;
            }
            var hasToken = !string.IsNullOrEmpty(info?.TokenHash);

            if (!tokenCapable)
            {
                // A deployed v2.7.x client: it would discard the token and then be locked out of its own
                // heartbeats. Leave the row exactly as it is.
                if (hasToken) await Audit("LEGACY_REGISTER_ON_TOKENED_ROW", device.DeviceId, device.DeviceUuid, remoteIp);
                return null;
            }

            if (!hasToken)
                return await WriteTokenOrThrowAsync(numericId, null, "ISSUED", device.DeviceUuid, remoteIp);

            if (TokenMatches(presentedToken, info!.TokenHash))
                return await WriteTokenOrThrowAsync(numericId, info.TokenHash, "ROTATED", device.DeviceUuid, remoteIp);

            // Device already holds a token and this request did not present it. PreAuthorizeRegister
            // normally refuses this earlier; the branch stays as a defensive check.
            if (_mode == DeviceAuthMode.Required)
            {
                await Audit("REJECT_REGISTER", device.DeviceId, device.DeviceUuid, remoteIp);
                throw new DeviceAuthRejectedException();
            }

            if (_reclaimOnRegister)
                return await WriteTokenOrThrowAsync(numericId, info.TokenHash, "RECLAIMED_WITHOUT_TOKEN", device.DeviceUuid, remoteIp);

            await Audit("REGISTER_WITHOUT_TOKEN", device.DeviceId, device.DeviceUuid, remoteIp);
            return null;
        }

        // Contract T2. Resolves ONLY the row named by {id}; never creates or re-points anything.
        public async Task<ClaimOutcome> ClaimAsync(string id, string? deviceKey, string? macAddress, string? presentedToken, string? remoteIp)
        {
            DeviceAuthInfo? info;
            try
            {
                info = string.IsNullOrWhiteSpace(id) ? null : await LookupAsync(id.Trim());
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[DeviceAuth] CLAIM_LOOKUP_FAILED | device={id} | {ex.Message}");
                return new ClaimOutcome { Status = ClaimStatus.Unavailable };
            }

            if (info == null)
            {
                await Audit("CLAIM_NOT_FOUND", id, deviceKey, remoteIp);
                return new ClaimOutcome { Status = ClaimStatus.NotFound };
            }

            try
            {
                if (!string.IsNullOrEmpty(info.TokenHash))
                {
                    if (TokenMatches(presentedToken, info.TokenHash))
                    {
                        var rotated = await WriteTokenOrThrowAsync(info.DeviceId, info.TokenHash, "CLAIM_ROTATED", info.DeviceUuid, remoteIp);
                        return new ClaimOutcome { Status = ClaimStatus.Rotated, Token = rotated, Info = info };
                    }
                    await Audit("CLAIM_ALREADY_ISSUED", info.DeviceId.ToString(), deviceKey, remoteIp);
                    return new ClaimOutcome { Status = ClaimStatus.AlreadyIssued, Info = info };
                }

                if (!ClaimEvidenceMatches(info.DeviceUuid, info.MacAddress, deviceKey, macAddress))
                {
                    await Audit("CLAIM_EVIDENCE_MISMATCH", info.DeviceId.ToString(), deviceKey, remoteIp,
                        $"row uuid={info.DeviceUuid ?? "-"} row mac={(NormalizeMac(info.MacAddress) ?? "-")} given mac={(NormalizeMac(macAddress) ?? "-")}");
                    return new ClaimOutcome { Status = ClaimStatus.EvidenceMismatch, Info = info };
                }

                var token = await WriteTokenOrThrowAsync(info.DeviceId, null, "CLAIM_ISSUED", info.DeviceUuid, remoteIp);
                return new ClaimOutcome { Status = ClaimStatus.Issued, Token = token, Info = info };
            }
            catch (DeviceTokenRaceException)
            {
                // Another claim for the same row won between our read and our write. The caller gets
                // 409 and retries later; it must NOT keep a token the row does not hold.
                return new ClaimOutcome { Status = ClaimStatus.Race, Info = info };
            }
        }

        // Clears the token (an operator action, so it is not conditional) and leaves the R2 marker that
        // makes the next heartbeat carry RECLAIM_TOKEN.
        public async Task ResetAsync(string deviceId, long? adminUserId)
        {
            var info = await _devices.GetDeviceAuthInfoAsync(deviceId, null);
            if (info == null) throw new KeyNotFoundException("Device not found");
            await _devices.ResetDeviceTokenAsync(info.DeviceId);
            try
            {
                await _log.LogAsync(info.DeviceId.ToString(), "WARNING", $"[DeviceAuth] TOKEN_RESET | by user {adminUserId?.ToString() ?? "?"} | screen will be told to re-claim", "API", adminUserId);
            }
            catch { }
        }

        private async Task Audit(string outcome, string? deviceId, string? deviceUuid, string? remoteIp, string? detail = null)
        {
            var line = $"[DeviceAuth] {outcome} | device={deviceId ?? "-"} | uuid={deviceUuid ?? "-"} | ip={remoteIp ?? "-"} | mode={_mode}"
                       + (detail == null ? string.Empty : $" | {detail}");
            Console.WriteLine(line);
            if (outcome.StartsWith("REJECT", StringComparison.Ordinal) || outcome.Contains("WITHOUT_TOKEN") || outcome.StartsWith("CLAIM_", StringComparison.Ordinal)
                || outcome.StartsWith("LEGACY_", StringComparison.Ordinal) || outcome == "ADOPTION_BLOCKED" || outcome == "TOKEN_RACE")
            {
                try { await _log.LogAsync(deviceId, "WARNING", line, "API"); } catch { }
            }
        }
    }

    public sealed class DeviceAuthRejectedException : Exception
    {
        public DeviceAuthRejectedException() : base(DeviceAuthService.RejectMessage) { }
    }

    // Round 3 (R3): a conditional token write found the row changed by another issuance.
    public sealed class DeviceTokenRaceException : Exception
    {
        public DeviceTokenRaceException() : base(DeviceAuthService.RaceMessage) { }
    }

    public sealed class DeviceAuthInfo
    {
        public long DeviceId { get; set; }
        public string? DeviceUuid { get; set; }
        public string? TokenHash { get; set; }
        public string? MacAddress { get; set; }
        public DateTime? TokenIssuedAt { get; set; }
        // Round 3 (R2): set by an operator reset, cleared by the next successful token write.
        public DateTime? TokenResetAt { get; set; }
    }
}

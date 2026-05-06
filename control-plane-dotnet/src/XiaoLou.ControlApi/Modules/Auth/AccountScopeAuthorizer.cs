namespace XiaoLou.ControlApi.Modules.Auth;

internal static class AccountScopeAuthorizer
{
    internal static bool IsAccountScopeAllowed(
        ClientPrincipal? principal,
        string? configuredAllowedAccountIds,
        string? configuredAllowedAccountOwnerIds,
        bool requireConfiguredAccountGrant,
        bool shouldRequireConfiguredAccountGrant,
        string? headerAccountId,
        string? accountId,
        string? headerOwnerType,
        string? headerOwnerId,
        string ownerType,
        bool ownerTypeWasSpecified,
        string? ownerId)
    {
        if (principal?.FromAuthProvider == true)
        {
            if (!IsPrincipalAccountGrantAllowed(principal, accountId, ownerType, ownerId))
            {
                return false;
            }

            return !requireConfiguredAccountGrant
                || !shouldRequireConfiguredAccountGrant
                || IsConfiguredAccountGrantAllowed(configuredAllowedAccountIds, configuredAllowedAccountOwnerIds, accountId, ownerType, ownerId);
        }

        var configuredGrantAllowed = IsConfiguredAccountGrantAllowed(
            configuredAllowedAccountIds,
            configuredAllowedAccountOwnerIds,
            accountId,
            ownerType,
            ownerId);
        if (requireConfiguredAccountGrant && shouldRequireConfiguredAccountGrant)
        {
            return configuredGrantAllowed;
        }

        if (headerAccountId is not null && accountId is not null)
        {
            return string.Equals(headerAccountId, accountId, StringComparison.OrdinalIgnoreCase);
        }

        if (configuredGrantAllowed)
        {
            return true;
        }

        if (headerOwnerId is not null && ownerId is not null)
        {
            return string.Equals(headerOwnerId, ownerId, StringComparison.Ordinal)
                && (!ownerTypeWasSpecified
                    || headerOwnerType is null
                    || string.Equals(headerOwnerType, ownerType, StringComparison.Ordinal));
        }

        return false;
    }

    internal static bool ContainsCsvGrant(string? csv, string value)
    {
        if (string.IsNullOrWhiteSpace(csv))
        {
            return false;
        }

        return csv.Split(
                new[] { ',', ';', ' ', '\r', '\n', '\t' },
                StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(item => item == "*"
                || string.Equals(item, value, StringComparison.OrdinalIgnoreCase)
                || IsPrefixGrantMatch(item, value));
    }

    private static bool IsPrincipalAccountGrantAllowed(
        ClientPrincipal principal,
        string? accountId,
        string ownerType,
        string? ownerId)
    {
        if (accountId is not null && ContainsCsvGrant(principal.AllowedAccountIds, accountId))
        {
            return true;
        }

        if (ownerId is not null
            && (ContainsCsvGrant(principal.AllowedAccountOwnerIds, ownerId)
                || ContainsCsvGrant(principal.AllowedAccountOwnerIds, $"{ownerType}:{ownerId}")
                || ContainsCsvGrant(principal.AllowedAccountOwnerIds, $"{ownerType}:*")))
        {
            return true;
        }

        return false;
    }

    private static bool IsConfiguredAccountGrantAllowed(
        string? configuredAllowedAccountIds,
        string? configuredAllowedAccountOwnerIds,
        string? accountId,
        string ownerType,
        string? ownerId)
    {
        if (accountId is not null && ContainsCsvGrant(configuredAllowedAccountIds, accountId))
        {
            return true;
        }

        if (ownerId is not null
            && (ContainsCsvGrant(configuredAllowedAccountOwnerIds, ownerId)
                || ContainsCsvGrant(configuredAllowedAccountOwnerIds, $"{ownerType}:{ownerId}")
                || ContainsCsvGrant(configuredAllowedAccountOwnerIds, $"{ownerType}:*")))
        {
            return true;
        }

        return false;
    }

    private static bool IsPrefixGrantMatch(string grant, string value)
    {
        if (!grant.EndsWith(":*", StringComparison.Ordinal))
        {
            return false;
        }

        var prefix = grant[..^1];
        return value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }
}

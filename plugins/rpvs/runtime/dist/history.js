export function withHistory(detail, includeHistory) {
    const uboHistoryCount = detail.ubos.all.length;
    const authHistoryCount = detail.authorizedPersons.all.length;
    const trimmed = {
        ...detail,
        partnerHistory: includeHistory ? detail.partnerHistory : [],
        ubos: {
            current: detail.ubos.current,
            historyCount: uboHistoryCount,
            ...(includeHistory ? { all: detail.ubos.all } : {}),
        },
        authorizedPersons: {
            current: detail.authorizedPersons.current,
            historyCount: authHistoryCount,
            ...(includeHistory ? { all: detail.authorizedPersons.all } : {}),
        },
        ...(includeHistory ? {} : { historyOmitted: true }),
    };
    return trimmed;
}

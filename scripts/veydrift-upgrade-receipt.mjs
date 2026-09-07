const upgradedEventTopic = "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b";

export function receiptActivatesImplementation(receipt, proxy, implementation) {
  const expectedProxy = proxy.toLowerCase();
  const expectedImplementation = implementation.toLowerCase();
  return (receipt?.logs ?? []).some((log) => {
    if (log?.address?.toLowerCase() !== expectedProxy) return false;
    if (log?.topics?.[0]?.toLowerCase() !== upgradedEventTopic) return false;
    const implementationTopic = log?.topics?.[1];
    if (typeof implementationTopic !== "string" || implementationTopic.length !== 66) return false;
    return `0x${implementationTopic.slice(-40).toLowerCase()}` === expectedImplementation;
  });
}

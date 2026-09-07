const upgradedEventTopic = "0xbc7cd75a20ee27fd9adebab32041f755214907a5e5bad2d344f9b2146899d2bc";

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

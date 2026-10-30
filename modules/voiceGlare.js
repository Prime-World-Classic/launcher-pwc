// Встречные звонки (glare): обе стороны отправили offer друг другу одновременно,
// например восстановление после боя + VFriendMerge. Если обе стороны просто игнорируют
// чужой offer, оба звонка гаснут по таймауту. Уступает сторона с большим id —
// то же правило, что в Voice.mergeFriendCalls (звонит меньший id).
export function shouldYieldToIncomingCall(selfId, callerId, existingPeer) {
  const self = Number(selfId);
  const caller = Number(callerId);
  if (!Number.isFinite(self) || self <= 0 || !Number.isFinite(caller) || caller <= 0) {
    return false;
  }
  // have-local-offer = наш исходящий offer ещё без ответа
  if (existingPeer?.signalingState !== 'have-local-offer') {
    return false;
  }
  return self > caller;
}

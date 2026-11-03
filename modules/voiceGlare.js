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

// Новый звонок при переподключении значит, что своё прежнее соединение собеседник уже закрыл.
// Если наша запись не соединена и не ждёт ответа на свой offer, она мертва. Раньше такой звонок
// игнорировался, и связь не возвращалась, пока запись не закроется сама.
export function shouldReplaceDeadCall(existingPeer, isReconnect) {
  if (!isReconnect) {
    return false;
  }
  return existingPeer?.signalingState === 'stable' && existingPeer?.connectionState !== 'connected';
}

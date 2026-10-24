export async function connectAndVerifyPrivateInbox(
  connect: () => Promise<string | null>,
  unlock: () => Promise<string>,
): Promise<string | null> {
  const address = await connect();
  if (!address) return null;
  await unlock();
  return address;
}

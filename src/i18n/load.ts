import { namespaces, type Locale } from "./config";

export async function loadMessages(locale: Locale) {
  const entries = await Promise.all(
    namespaces.map(async (ns) => [ns, (await import(`./messages/${locale}/${ns}.json`)).default] as const),
  );
  return Object.fromEntries(entries);
}

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { MessageCircle, Send } from "lucide-react";
import { useAdminStore } from "@/lib/store";
import { api } from "@/lib/api";
import { counselorLabel, personName, telecallerLabel } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function WhatsAppChat() {
  const store = useAdminStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const conversations = useMemo(
    () =>
      [...store.whatsappConversations].sort((a, b) =>
        String(b.last_message_at || "").localeCompare(String(a.last_message_at || "")),
      ),
    [store.whatsappConversations],
  );

  const selected =
    conversations.find((item) => item.id === selectedId) || conversations[0] || null;

  const messages = useMemo(
    () =>
      store.whatsappMessages
        .filter((item) => item.conversation_id === selected?.id)
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
    [store.whatsappMessages, selected?.id],
  );

  const lead = selected
    ? store.leads.find((row) => String(row.id) === String(selected.lead_id))
    : null;

  async function selectConversation(id: string) {
    setSelectedId(id);
    setError("");
    try {
      await api(`/whatsapp/conversations/${id}/read`, { method: "POST" });
    } catch {
      // Polling will sync read state; ignore transient errors.
    }
  }

  async function sendReply() {
    if (!selected || !draft.trim()) return;
    setSending(true);
    setError("");
    try {
      await api("/whatsapp/messages", {
        method: "POST",
        body: { conversationId: selected.id, message: draft.trim() },
      });
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message");
    } finally {
      setSending(false);
    }
  }

  const staffLabel =
    selected?.staff_role === "counselor"
      ? counselorLabel(store.counselors, selected.assigned_staff_id)
      : selected?.staff_role === "telecaller"
        ? telecallerLabel(store.telecallers, selected.assigned_staff_id)
        : "Unassigned";

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
          <MessageCircle className="h-6 w-6 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">WhatsApp</h1>
          <p className="text-slate-600">
            Lead and student WhatsApp threads — counselors for students, telecallers for leads.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card className="max-h-[70vh] overflow-y-auto p-2">
          {conversations.map((item) => {
            const rowLead = store.leads.find((row) => String(row.id) === String(item.lead_id));
            const unread = store.whatsappMessages.some(
              (msg) =>
                msg.conversation_id === item.id && msg.direction === "inbound" && !msg.is_read,
            );
            return (
              <button
                key={item.id}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm ${
                  selected?.id === item.id ? "bg-emerald-50" : "hover:bg-slate-50"
                }`}
                onClick={() => void selectConversation(item.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{personName(store.leads, rowLead?.user_id || item.lead_id)}</p>
                  {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}
                </div>
                <p className="text-xs text-slate-500">+{item.phone_number?.slice(-10) || "—"}</p>
                <p className="text-[10px] uppercase tracking-wide text-emerald-700">{item.staff_role || "staff"}</p>
              </button>
            );
          })}
          {conversations.length === 0 && (
            <p className="p-4 text-sm text-slate-500">
              No WhatsApp conversations yet. Messages appear when a verified student or lead replies on WhatsApp.
            </p>
          )}
        </Card>

        <Card className="flex max-h-[70vh] flex-col p-0">
          {!selected && (
            <p className="p-5 text-sm text-slate-500">Select a conversation to view messages.</p>
          )}
          {selected && (
            <>
              <div className="border-b border-slate-100 px-5 py-3">
                <p className="font-semibold">{personName(store.leads, lead?.user_id || selected.lead_id)}</p>
                <p className="text-xs text-slate-500">
                  WhatsApp +{selected.phone_number?.slice(-10)} · {staffLabel}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                {messages.length === 0 && (
                  <p className="text-sm text-slate-500">No messages in this thread yet.</p>
                )}
                {messages.map((item) => {
                  const outbound = item.direction === "outbound";
                  return (
                    <div
                      key={item.id}
                      className={`mb-3 max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                        outbound ? "ml-auto bg-emerald-600 text-white" : "bg-slate-100 text-slate-900"
                      }`}
                    >
                      <p>{item.body}</p>
                      {item.created_at && (
                        <p className={`mt-1 text-[10px] ${outbound ? "text-emerald-100" : "text-slate-400"}`}>
                          {format(new Date(item.created_at), "PP p")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-slate-100 p-4">
                {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    placeholder="Reply on WhatsApp…"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendReply();
                      }
                    }}
                  />
                  <Button disabled={sending || !draft.trim()} onClick={() => void sendReply()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

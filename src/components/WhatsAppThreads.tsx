import { format } from "date-fns";
import { Link } from "react-router-dom";
import { displayName } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import type { Lead, WhatsAppConversationRow, WhatsAppMessageRow } from "@/lib/types";

interface WhatsAppThreadsProps {
  conversations: WhatsAppConversationRow[];
  messages: WhatsAppMessageRow[];
  leads: Lead[];
  profileUrl: (lead: Lead | null, conversation: WhatsAppConversationRow) => string;
  emptyMessage: string;
}

function whenLabel(value?: string | null) {
  if (!value) return "";
  const ms = Date.now() - new Date(value).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  const days = Math.floor(ms / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export default function WhatsAppThreads({
  conversations,
  messages,
  leads,
  profileUrl,
  emptyMessage,
}: WhatsAppThreadsProps) {
  const threads = conversations
    .map((conv) => {
      const lead = leads.find((row) => String(row.id) === String(conv.lead_id)) || null;
      const msgs = messages
        .filter((msg) => msg.conversation_id === conv.id)
        .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
      return { conv, lead, msgs };
    })
    .sort((a, b) => String(b.conv.last_message_at || "").localeCompare(String(a.conv.last_message_at || "")));

  if (threads.length === 0) {
    return <Card className="p-8 text-center text-sm text-slate-500">{emptyMessage}</Card>;
  }

  return (
    <div className="space-y-4">
      <Card className="border-emerald-100 bg-emerald-50 p-4 text-xs text-slate-700">
        WhatsApp messages for assigned leads and students. Reply from Operations → WhatsApp.
      </Card>
      {threads.map(({ conv, lead, msgs }) => {
        const url = profileUrl(lead, conv);
        return (
          <Card key={conv.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <Link to={url} className="min-w-0 transition hover:opacity-80">
                <p className="text-sm font-semibold text-sky-700 hover:underline">
                  {lead ? displayName(lead.first_name, lead.last_name, lead.email) : "Unknown contact"}
                </p>
                <p className="text-xs text-slate-500">
                  +{conv.phone_number?.slice(-10) || "—"} · {msgs.length} message{msgs.length === 1 ? "" : "s"}
                  {conv.last_message_at ? ` · Last ${whenLabel(conv.last_message_at)}` : ""}
                </p>
              </Link>
              <Link to={url} className="text-xs font-semibold text-emerald-700 hover:underline">
                View profile
              </Link>
            </div>
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto bg-slate-50 p-4">
              {msgs.map((msg) => {
                const outbound = msg.direction === "outbound";
                return (
                  <div
                    key={msg.id}
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      outbound
                        ? "self-end rounded-br-sm bg-emerald-600 text-white"
                        : "self-start rounded-bl-sm border border-slate-200 bg-white"
                    }`}
                  >
                    <p>{msg.body}</p>
                    {msg.created_at && (
                      <p className={`mt-1 text-[10px] ${outbound ? "text-emerald-100" : "text-slate-400"}`}>
                        {format(new Date(msg.created_at), "PP p")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

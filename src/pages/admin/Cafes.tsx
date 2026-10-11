import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { Cafe } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { CITIES } from "../../data/seed";
import {
  Badge,
  EmptyState,
  Field,
  Modal,
  SectionHead,
  Skeleton,
  inputCls,
  useToast,
} from "../../components/ui";
import { inr, newId, rowCls, tdCls, thCls } from "./_util";

const blankCafe = (): Cafe => ({
  id: newId("cf"),
  name: "",
  city: CITIES[0],
  address: "",
  description: "",
  image: "",
  priceRange: "₹₹",
  openingHours: "",
  experiences: [],
  bookingInfo: "",
  rating: 4.5,
  partner: false,
  commissionPct: 10,
  agreementRef: null,
  totalBookings: 0,
  revenue: 0,
  menu: "",
});

export default function Cafes() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Cafe>(blankCafe());
  const [expInput, setExpInput] = useState("");
  const actor = session?.userId ?? "admin-1";

  const { data: cafesRaw, loading, error, refresh } = useAsync(
    (b) => b.listCafes(),
    [db],
    [] as Cafe[],
  );

  useEffect(() => db.subscribe("cafes", refresh), [db, refresh]);

  const cafes = cafesRaw.filter((c) => {
    const q = query.trim().toLowerCase();
    return !q || `${c.name} ${c.city} ${c.address}`.toLowerCase().includes(q);
  });

  const openNew = () => {
    setForm(blankCafe());
    setExpInput("");
    setFormOpen(true);
  };
  const openEdit = (c: Cafe) => {
    setForm({ ...c, experiences: [...c.experiences] });
    setExpInput(c.experiences.join(", "));
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toast("Enter the café name", "rose");
    if (!form.address.trim()) return toast("Enter the address", "rose");
    try {
      await db.upsertCafe(
        {
          ...form,
          experiences: expInput
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          agreementRef: form.partner ? form.agreementRef?.trim() || null : null,
        },
        actor,
      );
      setFormOpen(false);
      refresh();
      toast(`Café ${form.name} saved`, "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save café", "rose");
    }
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Venue network"
          title="Café Management"
          sub="Curated venues for Datevra experiences. Only verified business details and real booking information."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load cafés: {error}</p>}

        <div className="mt-8 glass rounded-2xl p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, city or address…"
            className={inputCls}
          />
          <button onClick={openNew} className="btn-gold rounded-xl px-5 py-3 text-sm sm:ml-auto whitespace-nowrap">
            + Add café
          </button>
        </div>

        <div className="glass rounded-3xl mt-6 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : cafes.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No cafés" body="Add your first curated venue to begin." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[960px]">
                <thead>
                  <tr>
                    <th className={thCls}>Café</th>
                    <th className={thCls}>City</th>
                    <th className={thCls}>Price</th>
                    <th className={thCls}>Partner</th>
                    <th className={thCls}>Bookings</th>
                    <th className={thCls}>Revenue</th>
                    <th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cafes.map((c) => (
                    <tr key={c.id} className={rowCls}>
                      <td className={tdCls}>
                        <p className="text-ivory font-medium">{c.name}</p>
                        <p className="text-xs text-mist line-clamp-1">{c.address}</p>
                      </td>
                      <td className={`${tdCls} text-ivory-dim whitespace-nowrap`}>{c.city}</td>
                      <td className={`${tdCls} text-champagne`}>{c.priceRange}</td>
                      <td className={tdCls}>
                        {c.partner ? <Badge tone="gold">Partner</Badge> : <Badge tone="muted">Listed</Badge>}
                      </td>
                      <td className={`${tdCls} text-ivory-dim`}>{c.totalBookings}</td>
                      <td className={`${tdCls} text-ivory-dim whitespace-nowrap`}>{inr(c.revenue)}</td>
                      <td className={tdCls}>
                        <button
                          onClick={() => openEdit(c)}
                          className="text-xs text-champagne hover:text-rosegold"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {formOpen && (
          <Modal open onClose={() => setFormOpen(false)} title={cafesRaw.some((c) => c.id === form.id) ? "Edit café" : "Add café"} wide>
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Café name">
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
                </Field>
                <Field label="City">
                  <select value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputCls}>
                    {CITIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Address">
                  <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Price range">
                  <select value={form.priceRange} onChange={(e) => setForm({ ...form, priceRange: e.target.value as Cafe["priceRange"] })} className={inputCls}>
                    <option value="₹">₹ — casual</option>
                    <option value="₹₹">₹₹ — mid-range</option>
                    <option value="₹₹₹">₹₹₹ — premium</option>
                  </select>
                </Field>
                <Field label="Opening hours">
                  <input value={form.openingHours} onChange={(e) => setForm({ ...form, openingHours: e.target.value })} className={inputCls} placeholder="9:00 AM – 11:00 PM" />
                </Field>
                <Field label="Menu (one item per line, with prices)">
                  <textarea value={form.menu} onChange={(e) => setForm({ ...form, menu: e.target.value })} className={inputCls} rows={5} placeholder={"Cappuccino — ₹280\nTruffle fries — ₹420"} />
                </Field>
                <Field label="Photo URL">
                  <input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} className={inputCls} placeholder="https://…" />
                </Field>
              </div>
              <Field label="Description">
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`${inputCls} min-h-20`} />
              </Field>
              <Field label="Experiences (comma-separated)">
                <input value={expInput} onChange={(e) => setExpInput(e.target.value)} className={inputCls} placeholder="Romantic Café, Coffee Date, Premium Dining" />
              </Field>
              <Field label="Booking information">
                <textarea value={form.bookingInfo} onChange={(e) => setForm({ ...form, bookingInfo: e.target.value })} className={`${inputCls} min-h-16`} placeholder="How members book; table minimums…" />
              </Field>
              <div className="grid md:grid-cols-3 gap-4">
                <Field label="Partner">
                  <select value={form.partner ? "yes" : "no"} onChange={(e) => setForm({ ...form, partner: e.target.value === "yes" })} className={inputCls}>
                    <option value="no">Listed only</option>
                    <option value="yes">Partner</option>
                  </select>
                </Field>
                <Field label="Commission %">
                  <input value={String(form.commissionPct)} onChange={(e) => setForm({ ...form, commissionPct: Number(e.target.value) })} inputMode="decimal" className={inputCls} />
                </Field>
                <Field label="Agreement reference">
                  <input value={form.agreementRef ?? ""} onChange={(e) => setForm({ ...form, agreementRef: e.target.value })} className={inputCls} placeholder="CAFE-2026-…" />
                </Field>
              </div>
              <button onClick={save} className="btn-gold rounded-xl px-6 py-3 text-sm w-full">
                Save café
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

import React, { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Gift,
  RefreshCw,
  ScanLine,
  X,
} from "lucide-react";
import {
  getGiftCardConfig,
  GiftCardConfig,
  GiftEntitlement,
  GiftEntitlementStatus,
  GiftPage,
  GiftProduct,
  GiftRedemption,
  grantGiftEntitlement,
  listGiftEntitlements,
  listGiftProducts,
  listGiftRedemptions,
  newGiftRequestKey,
  redeemGiftCredential,
  voidGiftEntitlement,
} from "../api/giftCards";
import { operations } from "../config/operations";
import { useAuthStore } from "../stores/authStore";
import { useShopStore } from "../stores/shop";
import { useConfirmation } from "./Confirmation";
import OperationalPage from "./OperationalPage";
import ResourcePicker from "./ResourcePicker";
import GiftOrdersPanel from "./gift/GiftOrdersPanel";
import { giftTimestamp } from "../utils/giftTimestamp";

const control =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15";
const button =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50";
const primary =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[#287c7c] px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50";
const statuses: Record<GiftEntitlementStatus, string> = {
  ACTIVE: "可使用",
  EXHAUSTED: "已用尽",
  EXPIRED: "已到期",
  VOIDED: "已作废",
};
const sources = {
  PROMOTIONAL: "免费赠送",
  PURCHASE: "购买权益",
  PURCHASED: "购买权益",
  LEGACY: "历史权益",
};
const uuidPattern =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
const productConfig = {
  ...operations["gift-card-management"],
  description:
    "配置产品价格、次数与有效期。免费赠送与付费购买分开记录；门店显式开启到店付后可创建购买订单。停用产品不会撤销已发权益，线上支付尚未开放。",
};
function Id({ children }: { children: string | null }) {
  return (
    <span className="break-all font-mono text-xs text-slate-500">
      {children || "—"}
    </span>
  );
}
function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <p
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700"
    >
      {message}
    </p>
  ) : null;
}
function Status({ value }: { value: GiftEntitlementStatus }) {
  return (
    <span
      className={
        "inline-block whitespace-nowrap rounded-md px-2 py-1 text-xs " +
        (value === "ACTIVE"
          ? "bg-teal-50 text-teal-800"
          : "bg-slate-100 text-slate-600")
      }
    >
      {statuses[value]}
    </span>
  );
}

/** Each mounted shop panel owns its requests. A stale shop response cannot update its replacement. */
function useMutation(onBusyChange?: (busy: boolean) => void) {
  const alive = useRef(true),
    locked = useRef(false),
    requests = useRef(new Set<AbortController>());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requests.current.forEach((request) => request.abort());
      requests.current.clear();
      onBusyChange?.(false);
    };
  }, [onBusyChange]);
  const execute = async <T,>(
    request: (signal: AbortSignal) => Promise<T>,
    done: (value: T) => void,
  ) => {
    if (!alive.current || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    onBusyChange?.(true);
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const value = await request(controller.signal);
      if (alive.current && !controller.signal.aborted) done(value);
    } catch (err) {
      if (alive.current && !controller.signal.aborted)
        setError(err instanceof Error ? err.message : "操作未完成，请重试。");
    } finally {
      requests.current.delete(controller);
      locked.current = false;
      if (alive.current && !controller.signal.aborted) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  };
  return { alive, busy, error, setError, execute };
}
function FormDialog({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current
      ?.querySelector<HTMLElement>("button, input, select, textarea")
      ?.focus();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/35 p-3 sm:p-6">
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gift-form-title"
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.stopPropagation();
            onClose();
          }
          if (event.key === "Tab") {
            const items = panel.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
            );
            if (items?.length) {
              const first = items[0],
                last = items[items.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }
          }
        }}
      >
        <header className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <h2
            id="gift-form-title"
            className="text-lg font-semibold text-slate-900"
          >
            {title}
          </h2>
          <button
            type="button"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>
        <div className="p-5 sm:p-6">{children}</div>
      </section>
    </div>
  );
}
function Pagination({
  page,
  total,
  totalPages,
  busy,
  onChange,
}: {
  page: number;
  total: number;
  totalPages: number;
  busy: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 text-sm text-slate-500">
      <span>
        共 {total} 条 · 第 {page} / {Math.max(1, totalPages)} 页
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          aria-label="上一页"
          className={button}
          disabled={busy || page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={16} />
          上一页
        </button>
        <button
          type="button"
          aria-label="下一页"
          className={button}
          disabled={busy || page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          下一页
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function ProductPicker({
  shopId,
  value,
  onChange,
  disabled,
}: {
  shopId: string;
  value: GiftProduct | null;
  onChange: (product: GiftProduct | null) => void;
  disabled: boolean;
}) {
  const [page, setPage] = useState(1),
    [reload, setReload] = useState(0);
  const [result, setResult] = useState<GiftPage<GiftProduct> | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setResult(null);
    listGiftProducts(shopId, page, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "产品加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [shopId, page, reload]);
  const options = [
    ...(value && !result?.items.some((item) => item.id === value.id)
      ? [value]
      : []),
    ...(result?.items ?? []),
  ];
  return (
    <div className="space-y-2">
      <select
        aria-label="赠送产品"
        required
        disabled={disabled || loading}
        className={control}
        value={value?.id ?? ""}
        onChange={(event) =>
          onChange(
            options.find((item) => item.id === event.target.value) ?? null,
          )
        }
      >
        <option value="">
          {loading ? "正在读取可赠送产品…" : "请选择已启用产品"}
        </option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title} · {item.useTimes} 次 / {item.expireDays} 天 (#{item.id}
            )
          </option>
        ))}
      </select>
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            className="underline"
            onClick={() => setReload((value) => value + 1)}
          >
            重试
          </button>
        </div>
      )}
      {!loading && !error && !result?.total && (
        <p className="text-xs leading-5 text-slate-500">
          暂无可赠送产品。门店须已发布、店主账号有效，且产品配置已启用。
        </p>
      )}
      {result && result.totalPages > 1 && (
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <button
            type="button"
            disabled={disabled || loading || page <= 1}
            onClick={() => setPage((value) => value - 1)}
            className="disabled:opacity-40"
          >
            上一页
          </button>
          <span>
            产品第 {page} / {result.totalPages} 页
          </span>
          <button
            type="button"
            disabled={disabled || loading || page >= result.totalPages}
            onClick={() => setPage((value) => value + 1)}
            className="disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
      {value && (
        <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">
          本次免费赠送 {value.useTimes} 次，有效期由服务器按 {value.expireDays}{" "}
          天计算；不产生销售收入。
        </p>
      )}
    </div>
  );
}
function GrantDialog({
  shopId,
  onClose,
  onSaved,
  onBusyChange,
}: {
  shopId: string;
  onClose: () => void;
  onSaved: (item: GiftEntitlement) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { isSuperAdmin } = useAuthStore();
  const [product, setProduct] = useState<GiftProduct | null>(null),
    [userId, setUserId] = useState(""),
    [reason, setReason] = useState("");
  const key = useRef<string | null>(null),
    mutation = useMutation(onBusyChange),
    confirm = useConfirmation();
  const changed = () => {
    key.current = null;
    mutation.setError("");
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!product || !reason.trim() || mutation.busy) return;
    if (
      !(await confirm({
        title: "确认免费赠送",
        message: `向顾客 #${userId} 赠送「${product.title}」${product.useTimes} 次权益。此操作不收款、不增加商家收入。`,
        confirmLabel: "确认赠送",
        tone: "primary",
      })) ||
      !mutation.alive.current
    )
      return;
    key.current ??= newGiftRequestKey();
    const payload = {
      productId: product.id,
      userId,
      reason: reason.trim(),
      requestKey: key.current,
    };
    await mutation.execute(
      (signal) => grantGiftEntitlement(shopId, payload, signal),
      (item) => {
        key.current = null;
        onSaved(item);
      },
    );
  };
  return (
    <FormDialog title="免费赠送顾客权益" busy={mutation.busy} onClose={onClose}>
      <form onSubmit={submit} className="space-y-5">
        <ErrorNotice message={mutation.error} />
        <fieldset disabled={mutation.busy} className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">已启用产品</p>
            <ProductPicker
              shopId={shopId}
              value={product}
              disabled={mutation.busy}
              onChange={(value) => {
                changed();
                setProduct(value);
              }}
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="gift-grant-user"
              className="text-sm font-medium text-slate-700"
            >
              接收顾客
            </label>
            {isSuperAdmin ? (
              <ResourcePicker
                resource="users"
                value={userId}
                required
                onChange={(value) => {
                  changed();
                  setUserId(String(value));
                }}
              />
            ) : (
              <input
                id="gift-grant-user"
                className={control}
                value={userId}
                required
                inputMode="numeric"
                pattern="[1-9][0-9]{0,18}"
                placeholder="有效顾客账号 ID"
                onChange={(event) => {
                  changed();
                  setUserId(event.target.value);
                }}
              />
            )}
            <p className="text-xs text-slate-500">
              服务器会验证该顾客账号是否有效。
            </p>
          </div>
          <div className="space-y-2">
            <label
              htmlFor="gift-grant-reason"
              className="text-sm font-medium text-slate-700"
            >
              赠送原因
            </label>
            <textarea
              id="gift-grant-reason"
              required
              maxLength={500}
              rows={3}
              value={reason}
              className={control}
              onChange={(event) => {
                changed();
                setReason(event.target.value);
              }}
              placeholder="填写可核对的赠送原因（最多 500 字）"
            />
          </div>
        </fieldset>
        <p className="text-xs leading-5 text-slate-500">
          若网络中断，请保持内容不变重试；相同请求不会重复赠送。修改内容会作为新的赠送申请。
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            className={button}
            disabled={mutation.busy}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="submit"
            className={primary}
            disabled={mutation.busy || !product || !userId || !reason.trim()}
          >
            {mutation.busy ? "提交中…" : "确认赠送"}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}
function VoidDialog({
  item,
  onClose,
  onSaved,
  onBusyChange,
}: {
  item: GiftEntitlement;
  onClose: () => void;
  onSaved: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [reason, setReason] = useState(""),
    mutation = useMutation(onBusyChange),
    confirm = useConfirmation();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason.trim() || mutation.busy) return;
    if (
      !(await confirm({
        title: "作废免费赠送权益",
        message: `确认作废「${item.productTitleSnapshot || "产品 #" + item.productId}」的未使用权益？此操作不会退款。`,
        confirmLabel: "确认作废",
        tone: "danger",
      })) ||
      !mutation.alive.current
    )
      return;
    await mutation.execute(
      (signal) =>
        voidGiftEntitlement(item.shopId, item.id, reason.trim(), signal),
      onSaved,
    );
  };
  return (
    <FormDialog
      title="作废未使用的赠送权益"
      busy={mutation.busy}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          <p>
            顾客 #{item.userId} · 剩余 {item.remainingUses} / {item.totalUses}{" "}
            次
          </p>
          <Id>{item.id}</Id>
          <p>
            仅免费赠送且从未使用的权益可作废。购买权益与历史权益不在此处理。
          </p>
        </div>
        <ErrorNotice message={mutation.error} />
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">作废原因</span>
          <textarea
            required
            disabled={mutation.busy}
            maxLength={500}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={control}
          />
        </label>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            className={button}
            disabled={mutation.busy}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="submit"
            className="rounded-lg bg-red-600 px-4 py-2.5 text-sm text-white disabled:opacity-50"
            disabled={mutation.busy || !reason.trim()}
          >
            {mutation.busy ? "处理中…" : "作废权益"}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}

interface Filters {
  status: GiftEntitlementStatus | "";
  userId: string;
  entitlementId: string;
}
const emptyFilters: Filters = { status: "", userId: "", entitlementId: "" };
function FiltersForm({
  draft,
  setDraft,
  withStatus,
  onApply,
  onReset,
}: {
  draft: Filters;
  setDraft: (draft: Filters) => void;
  withStatus: boolean;
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
      className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-5"
    >
      {withStatus && (
        <label className="min-w-36 flex-1 space-y-1.5 text-sm text-slate-600">
          <span>权益状态</span>
          <select
            className={control}
            value={draft.status}
            onChange={(event) =>
              setDraft({
                ...draft,
                status: event.target.value as Filters["status"],
              })
            }
          >
            <option value="">全部状态</option>
            {Object.entries(statuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="min-w-36 flex-1 space-y-1.5 text-sm text-slate-600">
        <span>顾客 ID</span>
        <input
          className={control}
          inputMode="numeric"
          pattern="[1-9][0-9]{0,18}"
          placeholder="精确顾客 ID"
          value={draft.userId}
          onChange={(event) =>
            setDraft({ ...draft, userId: event.target.value })
          }
        />
      </label>
      <label className="min-w-52 flex-[2] space-y-1.5 text-sm text-slate-600">
        <span>权益 ID</span>
        <input
          className={control}
          pattern={uuidPattern}
          placeholder="完整权益 ID（UUID）"
          value={draft.entitlementId}
          onChange={(event) =>
            setDraft({ ...draft, entitlementId: event.target.value })
          }
        />
      </label>
      <button type="submit" className={primary}>
        查询
      </button>
      <button type="button" className={button} onClick={onReset}>
        重置
      </button>
    </form>
  );
}
function EntitlementsPanel({
  shopId,
  promotionalEnabled,
  onBusyChange,
}: {
  shopId: string;
  promotionalEnabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState<Filters>({ ...emptyFilters }),
    [filters, setFilters] = useState<Filters>({ ...emptyFilters });
  const [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [result, setResult] = useState<GiftPage<GiftEntitlement> | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [grantOpen, setGrantOpen] = useState(false),
    [voidTarget, setVoidTarget] = useState<GiftEntitlement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setResult(null);
    listGiftEntitlements(
      shopId,
      { ...filters, page, pageSize: 20 },
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "权益加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [shopId, filters, page, reload]);
  const refresh = () => {
    setPage(1);
    setReload((value) => value + 1);
  };
  return (
    <div className="space-y-4">
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-800"
        >
          {notice}
        </p>
      )}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h2 className="font-semibold text-slate-900">顾客权益</h2>
            <p className="mt-1 text-sm text-slate-500">
              按门店查询真实剩余次数；产品停用不会撤销已有权益。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={button}
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCw size={16} />
              刷新
            </button>
            <button
              type="button"
              className={primary}
              disabled={!promotionalEnabled}
              onClick={() => setGrantOpen(true)}
            >
              <Gift size={16} />
              免费赠送
            </button>
          </div>
        </header>
        <FiltersForm
          draft={draft}
          setDraft={setDraft}
          withStatus
          onApply={() => {
            setPage(1);
            setFilters({ ...draft });
          }}
          onReset={() => {
            setDraft({ ...emptyFilters });
            setFilters({ ...emptyFilters });
            setPage(1);
          }}
        />
        <div className="px-5 pt-4">
          <ErrorNotice message={error} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th>产品与权益 ID</th>
                <th>顾客 / 产品 ID</th>
                <th>来源</th>
                <th>剩余 / 总次数</th>
                <th>状态</th>
                <th>有效期 / 创建时间（门店）</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result?.items.map((item) => (
                <tr key={item.id}>
                  <td className="max-w-72">
                    <p className="mb-1 font-medium text-slate-800">
                      {item.productTitleSnapshot || "产品名称未提供"}
                    </p>
                    <Id>{item.id}</Id>
                  </td>
                  <td>
                    <p>顾客 #{item.userId}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      产品 #{item.productId}
                    </p>
                    {item.orderId && (
                      <p className="mt-1 text-xs text-slate-500">
                        订单 #{item.orderId}
                      </p>
                    )}
                  </td>
                  <td>
                    <span className="whitespace-nowrap">
                      {sources[item.source]}
                    </span>
                    {item.grantReasonRecorded && (
                      <p className="mt-1 text-xs text-slate-400">
                        赠送原因已记录
                      </p>
                    )}
                    {item.voidReasonRecorded && (
                      <p className="mt-1 text-xs text-slate-400">
                        作废原因已记录
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="font-semibold text-slate-900">
                      {item.remainingUses}
                    </span>
                    <span className="text-slate-400">
                      {" "}
                      / {item.totalUses} 次
                    </span>
                  </td>
                  <td>
                    <Status value={item.status} />
                  </td>
                  <td className="whitespace-nowrap text-xs leading-6 text-slate-500">
                    <p>至 {giftTimestamp(item.expiresAt, item.timezone)}</p>
                    <p>创建 {giftTimestamp(item.createdAt, item.timezone)}</p>
                  </td>
                  <td>
                    {item.source === "PROMOTIONAL" &&
                    !item.orderId &&
                    item.remainingUses === item.totalUses &&
                    ["ACTIVE", "EXPIRED"].includes(item.status) ? (
                      <button
                        type="button"
                        onClick={() => setVoidTarget(item)}
                        className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50"
                      >
                        作废
                      </button>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading ? (
          <p role="status" className="p-8 text-center text-sm text-slate-500">
            正在读取权益…
          </p>
        ) : !error && !result?.items.length ? (
          <p className="p-8 text-center text-sm text-slate-500">
            暂无符合条件的权益。
          </p>
        ) : null}
        {error && (
          <div className="px-5 pb-5">
            <button type="button" className={button} onClick={refresh}>
              重新加载
            </button>
          </div>
        )}
        <Pagination
          page={page}
          total={result?.total ?? 0}
          totalPages={result?.totalPages ?? 0}
          busy={loading}
          onChange={setPage}
        />
      </section>
      {grantOpen && (
        <GrantDialog
          shopId={shopId}
          onBusyChange={onBusyChange}
          onClose={() => setGrantOpen(false)}
          onSaved={(item) => {
            setGrantOpen(false);
            setNotice(
              `已免费赠送 ${item.totalUses} 次权益，顾客 #${item.userId}；未产生销售收入。`,
            );
            refresh();
          }}
        />
      )}
      {voidTarget && (
        <VoidDialog
          item={voidTarget}
          onBusyChange={onBusyChange}
          onClose={() => setVoidTarget(null)}
          onSaved={() => {
            setVoidTarget(null);
            setNotice("权益已作废，未执行退款。");
            refresh();
          }}
        />
      )}
    </div>
  );
}

function RedemptionsPanel({
  shopId,
  credentialTtlSeconds,
  onBusyChange,
}: {
  shopId: string;
  credentialTtlSeconds?: number;
  onBusyChange: (busy: boolean) => void;
}) {
  const [token, setToken] = useState(""),
    [uses, setUses] = useState("1"),
    [notice, setNotice] = useState("");
  const requestKey = useRef<string | null>(null),
    mutation = useMutation(onBusyChange),
    confirm = useConfirmation();
  const [draft, setDraft] = useState<Filters>({ ...emptyFilters }),
    [filters, setFilters] = useState<Filters>({ ...emptyFilters });
  const [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [result, setResult] = useState<GiftPage<GiftRedemption> | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setResult(null);
    listGiftRedemptions(
      shopId,
      {
        userId: filters.userId,
        entitlementId: filters.entitlementId,
        page,
        pageSize: 20,
      },
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "核销记录加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [shopId, filters, page, reload]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mutation.busy) return;
    const usedUses = Number(uses);
    if (!Number.isSafeInteger(usedUses) || usedUses < 1 || usedUses > 10000) {
      mutation.setError("请输入 1 至 10000 的整数次数。");
      return;
    }
    if (
      !(await confirm({
        title: "确认核销次数",
        message: `将从顾客凭证对应权益中扣除 ${usedUses} 次。请先与顾客核对门店及次数；本操作不收取款项。`,
        confirmLabel: `核销 ${usedUses} 次`,
        tone: "primary",
      })) ||
      !mutation.alive.current
    )
      return;
    requestKey.current ??= newGiftRequestKey();
    const payload = {
      token: token.trim(),
      usedUses,
      requestKey: requestKey.current,
    };
    await mutation.execute(
      (signal) => redeemGiftCredential(shopId, payload, signal),
      (value) => {
        setToken("");
        requestKey.current = null;
        setNotice(
          `${value.replayed ? "已确认此前核销结果，未重复扣次" : "核销成功"}：${value.item.usedUses} 次。${value.remainingUses === undefined ? "" : `剩余 ${value.remainingUses} 次。`}核销记录 ${value.item.id}`,
        );
        setPage(1);
        setReload((value) => value + 1);
      },
    );
  };
  const changed = () => {
    requestKey.current = null;
    mutation.setError("");
    setNotice("");
  };
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-xl bg-teal-50 p-2.5 text-teal-700">
            <ScanLine size={22} />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">
              使用顾客短时凭证核销
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              由顾客在自己的权益页生成一次凭证
              {credentialTtlSeconds
                ? `（有效 ${Math.ceil(credentialTtlSeconds / 60)} 分钟）`
                : ""}
              ，本次次数必须与顾客确认的一致。
            </p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4" autoComplete="off">
          <ErrorNotice message={mutation.error} />
          {notice && (
            <p
              role="status"
              className="break-all rounded-xl bg-teal-50 p-4 text-sm leading-6 text-teal-800"
            >
              {notice}
            </p>
          )}
          <fieldset
            disabled={mutation.busy}
            className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr)_140px_auto]"
          >
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>顾客核销凭证</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                required
                pattern="gc1_[A-Za-z0-9_\-]{43}"
                maxLength={47}
                value={token}
                onChange={(event) => {
                  changed();
                  setToken(event.target.value);
                }}
                placeholder="粘贴顾客本次出示的凭证"
                className={control}
              />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>本次使用次数</span>
              <input
                type="number"
                required
                min={1}
                max={10000}
                step={1}
                value={uses}
                onChange={(event) => {
                  changed();
                  setUses(event.target.value);
                }}
                className={control}
              />
            </label>
            <button
              type="submit"
              className={primary}
              disabled={mutation.busy || !token.trim()}
            >
              {mutation.busy ? "核销中…" : "核对并核销"}
            </button>
          </fieldset>
          <p className="text-xs leading-5 text-slate-500">
            凭证仅临时保留在当前输入框，成功或离开页面后清除。网络中断时保持凭证和次数不变重试，相同请求不会重复扣次。
          </p>
        </form>
      </section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <header className="flex items-center justify-between gap-4 p-5">
          <div>
            <h2 className="font-semibold text-slate-900">核销记录</h2>
            <p className="mt-1 text-sm text-slate-500">
              记录实际扣减次数，不代表付款或退款。
            </p>
          </div>
          <button
            type="button"
            className={button}
            disabled={loading}
            onClick={() => setReload((value) => value + 1)}
          >
            <RefreshCw size={16} />
            刷新
          </button>
        </header>
        <FiltersForm
          draft={draft}
          setDraft={setDraft}
          withStatus={false}
          onApply={() => {
            setFilters({ ...draft });
            setPage(1);
          }}
          onReset={() => {
            setDraft({ ...emptyFilters });
            setFilters({ ...emptyFilters });
            setPage(1);
          }}
        />
        <div className="px-5 pt-4">
          <ErrorNotice message={error} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th>核销记录 ID</th>
                <th>权益 ID</th>
                <th>使用次数</th>
                <th>操作人 ID</th>
                <th>时间（门店）</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result?.items.map((item) => (
                <tr key={item.id}>
                  <td className="max-w-64">
                    <Id>{item.id}</Id>
                  </td>
                  <td className="max-w-64">
                    <Id>{item.entitlementId}</Id>
                  </td>
                  <td className="font-semibold text-slate-800">
                    {item.usedUses} 次
                  </td>
                  <td>#{item.operatorId}</td>
                  <td className="whitespace-nowrap text-slate-500">
                    {giftTimestamp(item.createdAt, item.timezone)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading ? (
          <p role="status" className="p-8 text-center text-sm text-slate-500">
            正在读取核销记录…
          </p>
        ) : !error && !result?.items.length ? (
          <p className="p-8 text-center text-sm text-slate-500">
            暂无符合条件的核销记录。
          </p>
        ) : null}
        {error && (
          <div className="px-5 pb-5">
            <button
              type="button"
              className={button}
              onClick={() => setReload((value) => value + 1)}
            >
              重新加载
            </button>
          </div>
        )}
        <Pagination
          page={page}
          total={result?.total ?? 0}
          totalPages={result?.totalPages ?? 0}
          busy={loading}
          onChange={setPage}
        />
      </section>
    </div>
  );
}

export default function GiftCardManagement() {
  const { user } = useAuthStore();
  const { currentStoreId, setCurrentStoreId } = useShopStore();
  const shopId = currentStoreId == null ? "" : String(currentStoreId);
  const [tab, setTab] = useState<"products" | "entitlements" | "redemptions" | "orders">(
      "products",
    ),
    [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<GiftCardConfig | null>(null),
    [configError, setConfigError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setConfig(null);
    setConfigError("");
    getGiftCardConfig(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setConfig(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setConfigError(
            err instanceof Error ? err.message : "功能状态读取失败",
          );
      });
    return () => controller.abort();
  }, [reload]);
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          礼品卡与顾客权益
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          配置产品、处理到店付销售、免费赠送权益，并按顾客确认的次数核销。
        </p>
      </header>
      <div className="rounded-xl border border-teal-100 bg-teal-50/60 px-4 py-3 text-sm leading-6 text-teal-900">
        <strong className="font-medium">线上支付尚未开放。</strong>
        到店付需按店开启，实际收款登记后才发放购买权益；免费赠送与核销不产生销售收入或退款。
        {config && (
          <p className="mt-1 text-xs text-teal-800">{config.reason}</p>
        )}
        {!config && !configError && (
          <p className="text-xs text-teal-800">正在确认权益功能状态…</p>
        )}
      </div>
      {configError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <p role="alert" className="text-sm text-red-700">
            {configError} 免费赠送暂不可用。
          </p>
          <button
            type="button"
            className={button}
            onClick={() => setReload((value) => value + 1)}
          >
            重试功能状态
          </button>
        </div>
      )}
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-[140px_minmax(0,460px)]">
          <div>
            <p className="text-sm font-medium text-slate-700">当前操作门店</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              赠送和核销严格归属所选门店。
            </p>
          </div>
          <ResourcePicker
            resource="stores"
            value={shopId}
            onChange={(value) => setCurrentStoreId(String(value) || null)}
          />
        </div>
        <nav
          aria-label="礼品卡功能"
          className="flex flex-wrap gap-2 border-b border-slate-200 pb-3"
        >
          {(
            [
              { id: "products", label: "产品配置" },
              { id: "orders", label: "购买订单与销售政策" },
              { id: "entitlements", label: "顾客权益与赠送" },
              { id: "redemptions", label: "核销与记录" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              onClick={() => setTab(item.id)}
              className={
                "rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 " +
                (tab === item.id
                  ? "bg-[#287c7c] text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100")
              }
            >
              {item.label}
            </button>
          ))}
        </nav>
      </fieldset>
      {tab === "products" ? (
        <OperationalPage key={"products:" + shopId} config={productConfig} />
      ) : !shopId ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center text-sm text-slate-500">
          请先选择门店，再查看权益或进行核销。
        </section>
      ) : tab === "orders" ? (
        <GiftOrdersPanel key={"orders:" + shopId + ":" + user?.id} shopId={shopId} onBusyChange={setBusy} />
      ) : tab === "entitlements" ? (
        <EntitlementsPanel
          key={"entitlements:" + shopId}
          shopId={shopId}
          promotionalEnabled={config?.promotionalEntitlementsEnabled === true}
          onBusyChange={setBusy}
        />
      ) : (
        <RedemptionsPanel
          key={"redemptions:" + shopId}
          shopId={shopId}
          credentialTtlSeconds={config?.credentialTtlSeconds}
          onBusyChange={setBusy}
        />
      )}
    </div>
  );
}

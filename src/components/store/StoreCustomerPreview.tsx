import PriceMenuPreview from './PriceMenuPreview';
import React, { useState } from 'react';
import { Clock, ExternalLink, Image as ImageIcon, Mail, MapPin, Phone, Store, Video } from 'lucide-react';
import type { StoreDraft } from './types';
import { publicShopProfile, safePublicMediaUrl } from '../../../backend/src/common/shop-public-profile';
import { publicContactList, publicStoreMap } from '../../utils/publicContacts';
import { shopBrandHex } from '../../utils/shopBranding';
import { formatPublicShopAddress } from '../../../backend/src/common/public-shop-address';

interface StoreCustomerPreviewProps { draft: StoreDraft; saved: boolean; previewUrls?: ReadonlyMap<string, string>; }

const DAYS = [
  ['周一', 'Monday'], ['周二', 'Tuesday'], ['周三', 'Wednesday'], ['周四', 'Thursday'],
  ['周五', 'Friday'], ['周六', 'Saturday'], ['周日', 'Sunday'],
];
const PUBLICATION: Record<string, string> = {
  PENDING: 'Pending review', APPROVED: 'Published', REJECTED: 'Rejected', SUSPENDED: 'Unavailable',
};
const lines = (value: string) => value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
const accentWash = (hex: string, alpha: number) => {
  const match = /^#([\da-f]{6})$/i.exec(hex);
  if (!match) return `rgba(40, 124, 124, ${alpha})`;
  const value = Number.parseInt(match[1], 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

// Match the editor/server media policy; invalid legacy values never reach an image src.
export function safePreviewImageUrl(value: string): string | null {
  return safePublicMediaUrl(value);
}

function PreviewImage({ value, alt, className, logoText, compact = false, previewUrls }: {
  value: string; alt: string; className: string; logoText?: string; compact?: boolean; previewUrls?: ReadonlyMap<string, string>;
}) {
  const canonical = safePreviewImageUrl(value);
  const source = canonical && (previewUrls?.get(canonical) ?? canonical);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const unavailable = !source || failedSource === source;
  const isLogo = logoText !== undefined;
  return <div className={'relative overflow-hidden bg-[var(--shop-tint)] ' + className}>
    {unavailable ? <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-[#64748B]">
      {isLogo ? logoText ? <span className="max-w-full truncate text-xl font-semibold text-[var(--shop-accent)]">{logoText}</span> : <span role="img" aria-label="Store logo pending"><Store aria-hidden="true" className="h-6 w-6 text-[var(--shop-accent)] opacity-70" /></span> : <ImageIcon aria-hidden="true" className={compact ? 'h-5 w-5 text-[var(--shop-accent)] opacity-70' : 'h-7 w-7 text-[var(--shop-accent)] opacity-70'} />}
      {!isLogo && <span className={'leading-5 ' + (compact ? 'text-xs' : 'text-[13px]')}>{value.trim() ? 'Image currently unavailable' : 'Store photos pending'}</span>}
    </div> : <img src={source} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSource(source)} className={'h-full w-full ' + (isLogo ? 'object-contain' : 'object-cover')} />}
  </div>;
}

function ContactLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex min-w-0 items-start gap-2.5 text-[13px] leading-5 text-[#64748B]">
    <span aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--shop-accent)]">{icon}</span>
    <div className="min-w-0 whitespace-pre-wrap break-words">{children}</div>
  </div>;
}

function scheduledHours(hours: StoreDraft['businessHours'][string] | undefined) {
  if (!hours) return 'Not provided';
  if (!hours.open) return 'Closed';
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  const periods = hours.periods ?? [{ start: hours.start, end: hours.end }];
  if (periods.some(period => !time.test(period.start) || !time.test(period.end) || period.start >= period.end)) return 'Hours need review';
  return periods.map(period => period.start + ' – ' + period.end).join(' / ');
}

export default function StoreCustomerPreview({ draft, saved, previewUrls }: StoreCustomerPreviewProps) {
  const name = draft.name.trim();
  const profile = publicShopProfile({ description: draft.about, studioProfile: {
    subtitle: draft.subtitle, phones: lines(draft.phones), emails: lines(draft.emails), gallery: lines(draft.gallery), tags: lines(draft.tags),
    logo: draft.logo, logoUrl: draft.logoUrl, bannerUrl: draft.bannerUrl, videoUrl: draft.videoUrl, mapShareUrl: draft.mapShareUrl,
    links: { website: draft.websiteUrl, instagram: draft.instagramUrl, facebook: draft.facebookUrl }, brandColor: draft.brandColor,
  } });
  const brandAccent = shopBrandHex(profile.brandColor);
  const themeStyle = {
    '--shop-accent': brandAccent,
    '--shop-tint': accentWash(brandAccent, 0.08),
    '--shop-page': accentWash(brandAccent, 0.025),
    '--shop-border': accentWash(brandAccent, 0.16),
  } as React.CSSProperties;
  const phones = publicContactList(profile.phones, 'phone'), emails = publicContactList(profile.emails, 'email');
  const mapUrl = publicStoreMap(draft.address, draft.city, draft.state, draft.zipCode);
  const gallery = profile.media.galleryUrls;
  const visibleMenu = draft.priceMenu.map(group => ({ ...group, items: group.items.filter(item => item.isVisible !== false) })).filter(group => group.items.length > 0);
  const tags = profile.tags.slice(0, 6);
  const address = formatPublicShopAddress(draft.address, draft.city, draft.state, draft.zipCode);
  const logoText = draft.logo.trim();
  const videoProvided = Boolean(safePreviewImageUrl(draft.videoUrl));
  let timezone = 'Timezone not provided';
  if (draft.timezone.trim()) {
    try { new Intl.DateTimeFormat('en', { timeZone: draft.timezone.trim() }).format(); timezone = draft.timezone.trim(); }
    catch { timezone = 'Timezone needs review'; }
  }

  return <aside aria-label="Customer profile preview" style={themeStyle} className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-[350px] flex-col">
    <div className="flex min-h-0 flex-1 flex-col rounded-[36px] border-[3px] border-slate-300 bg-white p-2">
      <div aria-hidden="true" className="mx-auto mb-2 mt-1 h-1 w-14 shrink-0 rounded-full bg-slate-300" />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-[var(--shop-border)] bg-[var(--shop-page)]" lang="en">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--shop-border)] bg-white px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight text-[var(--shop-accent)]"><Store aria-hidden="true" className="h-4 w-4" />Massajoy</div>
          <span className="text-xs text-[#64748B]">Customer preview</span>
        </header>

        <div role="region" aria-label="Scrollable customer preview" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#48A1A1]">
          <PreviewImage previewUrls={previewUrls} value={profile.media.coverUrl ?? ''} alt={name ? name + ' store cover' : 'Store cover'} className="h-[136px] w-full border-b border-[var(--shop-border)]" />

          <section className="relative space-y-3 border-b border-[var(--shop-border)] bg-[var(--shop-page)] px-4 pb-5 pt-4">
            <div className="flex items-start gap-3">
              <PreviewImage previewUrls={previewUrls} value={profile.media.logoUrl ?? ''} alt={name ? name + ' logo' : 'Store logo'} logoText={logoText} compact className="h-14 w-14 shrink-0 rounded-[14px] border border-[var(--shop-border)]" />
              <div className="min-w-0 flex-1 space-y-1.5"><h4 className="break-words text-lg font-semibold leading-6 text-[#1E293B]">{name || 'Store name pending'}</h4>{profile.subtitle && <p className="break-words text-[13px] leading-5 text-[#64748B]">{profile.subtitle}</p>}{draft.shortName.trim() && <p className="break-all text-xs text-slate-400">{draft.shortName.trim()}</p>}</div>
            </div>
            {tags.length > 0 && <div aria-label="Store features" className="flex flex-wrap gap-1.5">{tags.map((tag, index) => <span key={index} style={{ borderColor: accentWash(brandAccent, 0.18), backgroundColor: accentWash(brandAccent, 0.07), color: brandAccent }} className="max-w-full break-words rounded-md border px-2 py-1 text-xs leading-4">{tag}</span>)}</div>}
          </section>

          <div className="space-y-3 p-3">
            <section aria-label="Visit & contact" className="space-y-3 rounded-[14px] border border-[var(--shop-border)] bg-white p-4">
              <h5 className="text-sm font-semibold text-[var(--shop-accent)]">Visit & contact</h5>
              <ContactLine icon={<MapPin className="h-4 w-4" />}><p>{address || 'Address not provided'}</p>{mapUrl && <a href={mapUrl} target="_blank" rel="noopener noreferrer" style={{ color: brandAccent }} className="mt-1 inline-block underline underline-offset-2">Open in Google Maps</a>}</ContactLine>
              <ContactLine icon={<Phone className="h-4 w-4" />}>{phones.length ? <ul className="space-y-1">{phones.map(contact => <li key={contact.href}><a href={contact.href} style={{ color: brandAccent }} className="underline underline-offset-2">{contact.label}</a></li>)}</ul> : 'Phone not provided'}</ContactLine>
              <ContactLine icon={<Mail className="h-4 w-4" />}>{emails.length ? <ul className="space-y-1">{emails.map(contact => <li key={contact.href}><a href={contact.href} style={{ color: brandAccent }} className="underline underline-offset-2">{contact.label}</a></li>)}</ul> : 'Email not provided'}</ContactLine>
              {profile.links.website && <ContactLine icon={<ExternalLink className="h-4 w-4" />}><a href={profile.links.website} target="_blank" rel="noopener noreferrer" style={{ color: brandAccent }} className="break-all underline underline-offset-2">Website</a></ContactLine>}
              {profile.links.instagram && <ContactLine icon={<ExternalLink className="h-4 w-4" />}><a href={profile.links.instagram} target="_blank" rel="noopener noreferrer" style={{ color: brandAccent }} className="break-all underline underline-offset-2">Instagram</a></ContactLine>}
              {profile.links.facebook && <ContactLine icon={<ExternalLink className="h-4 w-4" />}><a href={profile.links.facebook} target="_blank" rel="noopener noreferrer" style={{ color: brandAccent }} className="break-all underline underline-offset-2">Facebook</a></ContactLine>}
            </section>

            <section aria-label="Store gallery" className="space-y-3 rounded-[14px] border border-[var(--shop-border)] bg-white p-4">
              <h5 className="text-sm font-semibold text-[var(--shop-accent)]">Inside the store</h5>
              {gallery.length ? <div className="grid grid-cols-3 gap-2">{gallery.slice(0, 6).map((value, index) => <PreviewImage previewUrls={previewUrls} key={index + ':' + value} value={value} alt={'Gallery photo ' + (index + 1)} compact className="h-20 rounded-lg border border-[var(--shop-border)]" />)}</div> : <div className="flex items-center gap-2 rounded-lg bg-[var(--shop-page)] p-3 text-xs leading-5 text-[#64748B]"><ImageIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--shop-accent)]" /><p>Gallery photos not provided.</p></div>}
              {gallery.length > 6 && <p className="text-xs leading-5 text-[#64748B]">Preview shows the first 6 gallery photos.</p>}
              {draft.videoUrl.trim() && <div className="flex items-start gap-2 text-xs leading-5 text-[#64748B]"><Video aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--shop-accent)]" /><span>{videoProvided ? 'Video link provided. Playback is available on the customer page.' : 'Video link needs review.'}</span></div>}
            </section>

            {visibleMenu.length > 0 && (
              <section aria-label="Price menu" style={{ borderColor: accentWash(brandAccent, 0.2) }} className="space-y-4 rounded-[14px] border bg-white p-4">
                <h5 className="text-sm font-semibold text-[var(--shop-accent)]">Price menu</h5>
                <PriceMenuPreview value={visibleMenu} accentColor={brandAccent} />
              </section>
            )}

            <section aria-label="Store introduction" className="space-y-2 rounded-[14px] border border-[var(--shop-border)] bg-white p-4">
              <h5 className="text-sm font-semibold text-[var(--shop-accent)]">About the store</h5>
              <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-[#64748B]">{draft.about.trim() || 'Store introduction not provided.'}</p>
            </section>

            <section aria-label="Weekly opening hours" className="space-y-3 rounded-[14px] border border-[var(--shop-border)] bg-white p-4">
              <div className="flex items-center gap-2"><Clock aria-hidden="true" className="h-4 w-4 text-[var(--shop-accent)]" /><h5 className="text-sm font-semibold text-[var(--shop-accent)]">Weekly opening hours</h5></div>
              <p className="break-words text-xs leading-5 text-[#64748B]">{timezone}</p>
              <dl className="space-y-2">{DAYS.map(([key, label]) => <div key={key} className="flex items-start justify-between gap-3 text-xs leading-5"><dt className="text-[#64748B]">{label}</dt><dd className="text-right tabular-nums text-[#1E293B]">{scheduledHours(draft.businessHours[key])}</dd></div>)}</dl>
              <p className="border-t border-[var(--shop-border)] pt-2 text-xs leading-5 text-[#64748B]">Weekly schedule shown. Please contact the store to confirm current hours.</p>
            </section>

            <section aria-label="Display settings" className="space-y-2.5 rounded-[14px] border border-[var(--shop-border)] bg-white p-4">
              <h5 className="text-sm font-semibold text-[#1E293B]">Display settings</h5>
              <dl className="space-y-2 text-xs leading-5">
                <div className="flex justify-between gap-3"><dt className="text-[#64748B]">Publication</dt><dd className="text-right text-[#1E293B]">{PUBLICATION[draft.status] ?? 'Not provided'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[#64748B]">Online booking</dt><dd className="text-right text-[#1E293B]">{draft.onlineBooking ? 'Enabled in settings' : 'Disabled in settings'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[#64748B]">Customer reviews</dt><dd className="text-right text-[#1E293B]">{draft.reviews ? 'Enabled in settings' : 'Disabled in settings'}</dd></div>
              </dl>
              <p className="border-t border-[var(--shop-border)] pt-2 text-xs leading-5 text-[#64748B]">{saved ? 'Preview matches saved settings. Availability is confirmed on the customer page.' : 'Unsaved changes. The customer page has not been updated.'}</p>
            </section>
          </div>
        </div>

        <footer className="shrink-0 border-t border-[var(--shop-border)] bg-white px-4 py-3 text-center text-xs leading-5 text-[#64748B]">Profile preview · Book on the customer page.</footer>
      </div>
      <div aria-hidden="true" className="mx-auto mb-0.5 mt-2 h-1 w-20 shrink-0 rounded-full bg-slate-300" />
    </div>
  </aside>;
}

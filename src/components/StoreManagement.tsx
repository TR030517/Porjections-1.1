import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Plus, 
  Trash2, 
  X, 
  MapPin, 
  Phone, 
  Mail, 
  Clock, 
  Globe, 
  Key, 
  Eye, 
  EyeOff, 
  Sliders, 
  Sparkles, 
  ExternalLink,
  Image as ImageIcon,
  Video,
  Store,
  Compass,
  Check,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useUserStore } from '../stores/user';
import { useShopStore } from '../stores/shop';

// Premium stock assets to pick from
const PRESET_LOGOS = [
  { char: '🌿', name: '芳疗精油', color: 'bg-[#48a1a1]' },
  { char: '💆', name: '全身按摩', color: 'bg-rose-500' },
  { char: '🦶', name: '尊选足疗', color: 'bg-amber-500' },
  { char: '🧖', name: '日式洗浴', color: 'bg-indigo-500' },
  { char: '🏥', name: '理疗康复', color: 'bg-teal-600' },
];

const PRESET_BANNERS = [
  { url: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&h=300&q=80', name: '热石蜡烛' },
  { url: 'https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?auto=format&fit=crop&w=800&h=300&q=80', name: '雅致包间' },
  { url: 'https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=800&h=300&q=80', name: '舒活足疗' },
  { url: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=800&h=300&q=80', name: '泰式理疗' },
];

const PRESET_GALLERY_PHOTOS = [
  { id: 'g1', url: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=400&h=300&q=80', title: '理疗空间' },
  { id: 'g2', url: 'https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?auto=format&fit=crop&w=400&h=300&q=80', title: '独立双人包间' },
  { id: 'g3', url: 'https://images.unsplash.com/photo-1519493020453-3ff65d1b611c?auto=format&fit=crop&w=400&h=300&q=80', title: '单人专区' },
  { id: 'g4', url: 'https://images.unsplash.com/photo-1519415510236-718bdfcd89c8?auto=format&fit=crop&w=400&h=300&q=80', title: '奢华精油' },
  { id: 'g5', url: 'https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=400&h=300&q=80', title: '中堂前厅' },
  { id: 'g6', url: 'https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=400&h=300&q=80', title: '天然护肤油' },
  { id: 'g7', url: 'https://images.unsplash.com/photo-1519823551278-64ac928349d2?auto=format&fit=crop&w=400&h=300&q=80', title: '肩颈按摩操作' },
  { id: 'g8', url: 'https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=400&h=300&q=80', title: '泰式盐足' }
];

interface StoreHours {
  open: boolean;
  start: string;
  end: string;
}

interface StoreItem {
  id: number;
  shortName: string;
  logo: string; 
  logoUrl?: string; 
  bannerUrl: string;
  name: string;
  subtitle: string;
  phones: string[];
  emails: string[];
  sysAccount: string;
  sysPassword?: string;
  timezone: string;
  businessHours: Record<string, StoreHours>;
  tags: string[];
  features: {
    onlineBooking: boolean;
    onlinePayment: boolean;
    reviews: boolean;
    membershipCard: boolean;
  };
  dataStatus: '正常' | '关闭';
  businessStatus: '营业中' | '休息中';
  about: string;
  gallery: string[];
  videoUrl?: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  mapShareUrl?: string;
  mapEmbedIframe?: string;
  createdDate: string;
}

const initialStores: StoreItem[] = [
  {
    id: 3246,
    shortName: 'ArivaSpa',
    logo: '🏥',
    logoUrl: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=120&h=120&q=80',
    bannerUrl: 'https://images.unsplash.com/photo-1519493020453-3ff65d1b611c?auto=format&fit=crop&w=800&h=300&q=80',
    name: 'Ariva Spa',
    subtitle: 'Littleton Premium Hot Stone Massage & Chiropractic',
    phones: ['303-475-1111', '303-475-2222'],
    emails: ['arivamassage@gmail.com', 'contact@arivaspa.com'],
    sysAccount: 'ariva_spa_admin',
    sysPassword: 'arivapassword25',
    timezone: '(EDT) Eastern Time',
    businessHours: {
      '周一': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周二': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周三': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周四': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周五': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周六': { open: true, start: '10:00 AM', end: '08:00 PM' },
      '周日': { open: false, start: '10:00 AM', end: '06:00 PM' }
    },
    tags: ['Spa', 'Chiro', 'Hot Stones'],
    features: {
      onlineBooking: true,
      onlinePayment: true,
      reviews: true,
      membershipCard: false
    },
    dataStatus: '正常',
    businessStatus: '营业中',
    about: 'We provide top-notch physical relief, specializing in targeted chiropractic therapy, relaxation body massage, and warm herbal mineral treatments in the hearts of Littleton. Our therapists are state-certified with over 10 years of combined treatment excellence.',
    gallery: [
      PRESET_GALLERY_PHOTOS[0].url,
      PRESET_GALLERY_PHOTOS[1].url,
      PRESET_GALLERY_PHOTOS[2].url,
      PRESET_GALLERY_PHOTOS[5].url
    ],
    videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
    address: '6728 W Coal Mine Ave A110',
    city: 'Littleton',
    state: 'Colorado',
    zipCode: '80123',
    mapShareUrl: 'https://maps.app.goo.gl/9uKExCshg6fB',
    mapEmbedIframe: '<iframe src="https://www.google.com/maps/embed" width="100%" height="250"></iframe>',
    createdDate: '2026-05-29 10:07:23'
  },
  {
    id: 3221,
    shortName: 'Roesspa',
    logo: '💆',
    bannerUrl: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=800&h=300&q=80',
    name: 'Roes spa',
    subtitle: 'Classic Swedish Therapies & Facial Revitalization',
    phones: ['312-283-8685'],
    emails: ['roesspa9@gmail.com'],
    sysAccount: 'roes_spa_admin',
    sysPassword: 'roesepassword99',
    timezone: '(CDT) Central Time',
    businessHours: {
      '周一': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周二': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周三': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周四': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周五': { open: true, start: '09:00 AM', end: '11:00 PM' },
      '周六': { open: true, start: '09:00 AM', end: '11:00 PM' },
      '周日': { open: true, start: '10:00 AM', end: '08:00 PM' }
    },
    tags: ['Swedish Massage', 'Aromatherapy', 'Rejuvenation'],
    features: {
      onlineBooking: true,
      onlinePayment: false,
      reviews: true,
      membershipCard: true
    },
    dataStatus: '正常',
    businessStatus: '营业中',
    about: 'Roes Spa brings centuries-old European revitalizing oils and massage techniques. Relax and soothe your back tension and muscle stress with our expert team of therapists.',
    gallery: [
      PRESET_GALLERY_PHOTOS[3].url,
      PRESET_GALLERY_PHOTOS[4].url,
      PRESET_GALLERY_PHOTOS[6].url,
    ],
    address: '6054 W 159th St',
    city: 'Oak Forest',
    state: 'Illinois',
    zipCode: '60452',
    createdDate: '2026-05-23 10:19:05'
  },
  {
    id: 3201,
    shortName: 'howdyfootspa',
    logo: '🦶',
    logoUrl: 'https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=120&h=120&q=80',
    bannerUrl: 'https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=800&h=300&q=80',
    name: 'Howdy Foot Spa',
    subtitle: 'Foot specialist massages, warm mineral soaks and full relaxation',
    phones: ['713-539-8045'],
    emails: ['howdyfootspa@gmail.com'],
    sysAccount: 'howdy_foot_spa_admin',
    sysPassword: 'howdysecret40',
    timezone: '(CDT) Central Time',
    businessHours: {
      '周一': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周二': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周三': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周四': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周五': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周六': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周日': { open: true, start: '09:00 AM', end: '10:00 PM' }
    },
    tags: ['Foot Spa', 'Mineral Soak', 'Good Vibes'],
    features: {
      onlineBooking: true,
      onlinePayment: true,
      reviews: true,
      membershipCard: true
    },
    dataStatus: '正常',
    businessStatus: '营业中',
    about: 'Kick off your shoes and say howdy to relaxation! Our cozy spot serves up gentle foot massages, warm mineral soaks, and all the care your soles deserve. No stuffy rules—just good vibes, comfy chairs, and a chance to unwind from toe to tip.',
    gallery: [
      PRESET_GALLERY_PHOTOS[1].url,
      PRESET_GALLERY_PHOTOS[7].url,
      PRESET_GALLERY_PHOTOS[2].url,
      PRESET_GALLERY_PHOTOS[5].url,
    ],
    address: '13353 Jones Road, Norchester',
    city: 'Houston',
    state: 'Texas',
    zipCode: '77070',
    createdDate: '2026-05-30 01:10:00'
  }
];

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const TIME_OPTIONS = [
  '08:00 AM', '09:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
  '01:00 PM', '02:00 PM', '03:00 PM', '04:00 PM', '05:00 PM',
  '06:00 PM', '07:00 PM', '08:00 PM', '09:00 PM', '10:00 PM',
  '11:00 PM', '12:00 AM'
];

export default function StoreManagement() {
  const { isStoreManager } = useUserStore();
  const shopStoreContext = useShopStore();

  // Tab switcher in Edit Studio for STORE_MANAGER
  const [activeStudioTab, setActiveStudioTab] = useState<'profile' | 'technicians'>('profile');

  // Interactive Technician states
  const [technicians, setTechnicians] = useState<any[]>([
    { id: 1, name: '陈妙然 (Mia)', avatar: '🧖‍♀️', title: '资深高级精油芳疗师', experience: '8年经验', specialties: ['精油热石', '淋巴排毒', '香薰SPA'], rating: 4.9, status: '空闲' },
    { id: 2, name: '陆正峰 (Jason)', avatar: '💆‍♂️', title: '首席指压理疗康复师', experience: '12年经验', specialties: ['中医指压', '关节整复', '拔罐温灸'], rating: 4.9, status: '服务中' },
    { id: 3, name: '苏曼青 (Sophy)', avatar: '💁‍♀️', title: '面部活性管理专家', experience: '6年经验', specialties: ['面部焕彩', '头部经络舒缓'], rating: 4.8, status: '休息中' },
    { id: 4, name: '王振豪 (Tony)', avatar: '🧖‍♂️', title: '特级足膝反射理疗师', experience: '10年经验', specialties: ['足底反射区', '膝关节热敷'], rating: 4.9, status: '空闲' }
  ]);

  const [stores, setStores] = useState<StoreItem[]>(initialStores);
  const [searchText, setSearchText] = useState('');
  const [searchState, setSearchState] = useState('');
  const [searchCity, setSearchCity] = useState('');

  // Active Enter Store & Stats Dialog State
  const [activeEnterStore, setActiveEnterStore] = useState<StoreItem | null>(null);
  const [showConfirmEnter, setShowConfirmEnter] = useState(false);
  const [showStatsDialog, setShowStatsDialog] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [currentBranch, setCurrentBranch] = useState<any>(null);
  const [activePointIdx, setActivePointIdx] = useState<number | null>(null);

  useEffect(() => {
    if (activeEnterStore) {
      const mockBranchList = [
        {
          id: activeEnterStore.id,
          name: activeEnterStore.name,
          code: activeEnterStore.shortName || 'BRANCH-HQ',
          revenue: '2,480.00',
          orders: 22,
          techs: 5,
          rating: '4.9',
          chartData: [45, 60, 52, 80, 65, 85, 95]
        },
        {
          id: activeEnterStore.id + 100,
          name: activeEnterStore.name + ' - 丹佛分部 (Denver)',
          code: (activeEnterStore.shortName || 'BRANCH') + '-DEN',
          revenue: '1,950.00',
          orders: 16,
          techs: 4,
          rating: '4.8',
          chartData: [35, 45, 70, 55, 90, 75, 80]
        }
      ];
      setCurrentBranch(mockBranchList[0]);
    } else {
      setCurrentBranch(null);
    }
  }, [activeEnterStore]);

  // Form Studio Dialog Control
  const [studioOpen, setStudioOpen] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState<number | null>(null);

  // Form states matching user specification
  const [formName, setFormName] = useState('');
  const [formSubtitle, setFormSubtitle] = useState('');
  const [formShortName, setFormShortName] = useState('');
  const [formPhones, setFormPhones] = useState<string[]>(['']);
  const [formEmails, setFormEmails] = useState<string[]>(['']);
  const [formSysAccount, setFormSysAccount] = useState('');
  const [formSysPassword, setFormSysPassword] = useState('');
  const [formShowPassword, setFormShowPassword] = useState(false);

  const [formTimezone, setFormTimezone] = useState('(CDT) Central Time');
  const [formBusinessHours, setFormBusinessHours] = useState<Record<string, StoreHours>>({
    '周一': { open: true, start: '09:00 AM', end: '10:00 PM' },
    '周二': { open: true, start: '09:00 AM', end: '10:00 PM' },
    '周三': { open: true, start: '09:00 AM', end: '10:00 PM' },
    '周四': { open: true, start: '09:00 AM', end: '10:00 PM' },
    '周五': { open: true, start: '09:00 AM', end: '10:00 PM' },
    '周六': { open: true, start: '10:00 AM', end: '08:00 PM' },
    '周日': { open: false, start: '10:00 AM', end: '06:00 PM' }
  });

  const [formTags, setFormTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [formFeatures, setFormFeatures] = useState({
    onlineBooking: true,
    onlinePayment: false,
    reviews: true,
    membershipCard: false
  });
  const [formDataStatus, setFormDataStatus] = useState<'正常' | '关闭'>('正常');
  const [formBusinessStatus, setFormBusinessStatus] = useState<'营业中' | '休息中'>('营业中');

  // Media Display Assets 
  const [formLogo, setFormLogo] = useState('💆');
  const [formLogoUrl, setFormLogoUrl] = useState('');
  const [formBannerUrl, setFormBannerUrl] = useState(PRESET_BANNERS[0].url);
  const [formAbout, setFormAbout] = useState('');
  const [formGallery, setFormGallery] = useState<string[]>([]);
  const [formVideoUrl, setFormVideoUrl] = useState('');

  // Geospatial Locations
  const [formAddress, setFormAddress] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formStateVal, setFormStateVal] = useState('Texas');
  const [formZipCode, setFormZipCode] = useState('');
  const [formMapShareUrl, setFormMapShareUrl] = useState('');
  const [formMapEmbed, setFormMapEmbed] = useState('');

  // Dynamic Array Handlers
  const addPhoneField = () => setFormPhones([...formPhones, '']);
  const updatePhoneField = (index: number, val: string) => {
    const list = [...formPhones];
    list[index] = val;
    setFormPhones(list);
  };
  const removePhoneField = (index: number) => {
    if (formPhones.length === 1) {
      setFormPhones(['']);
    } else {
      setFormPhones(formPhones.filter((_, i) => i !== index));
    }
  };

  const addEmailField = () => setFormEmails([...formEmails, '']);
  const updateEmailField = (index: number, val: string) => {
    const list = [...formEmails];
    list[index] = val;
    setFormEmails(list);
  };
  const removeEmailField = (index: number) => {
    if (formEmails.length === 1) {
      setFormEmails(['']);
    } else {
      setFormEmails(formEmails.filter((_, i) => i !== index));
    }
  };

  // Tag Helpers
  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      if (!formTags.includes(tagInput.trim())) {
        setFormTags([...formTags, tagInput.trim()]);
      }
      setTagInput('');
    }
  };
  const handleRemoveTag = (indexToRemove: number) => {
    setFormTags(formTags.filter((_, idx) => idx !== indexToRemove));
  };

  // Sync Monday hours to the entire week helper
  const handleSyncWeekHours = () => {
    const mon = formBusinessHours['周一'];
    const updated = { ...formBusinessHours };
    WEEKDAYS.forEach(day => {
      updated[day] = { ...mon };
    });
    setFormBusinessHours(updated);
  };

  // Gallery Check Toggle
  const toggleGalleryPhoto = (url: string) => {
    if (formGallery.includes(url)) {
      setFormGallery(formGallery.filter(u => u !== url));
    } else {
      setFormGallery([...formGallery, url]);
    }
  };

  const triggerUploadMockFile = () => {
    const unchosen = PRESET_GALLERY_PHOTOS.filter(ph => !formGallery.includes(ph.url));
    if (unchosen.length > 0) {
      const selectPhoto = unchosen[Math.floor(Math.random() * unchosen.length)].url;
      setFormGallery([...formGallery, selectPhoto]);
    } else {
      // Rotate pick
      const randomUrl = PRESET_GALLERY_PHOTOS[Math.floor(Math.random() * PRESET_GALLERY_PHOTOS.length)].url;
      setFormGallery([...formGallery, randomUrl]);
    }
  };

  // Form Initialize Actions
  const openCreateStore = () => {
    setEditingStoreId(null);
    setFormName('');
    setFormSubtitle('');
    setFormShortName('');
    setFormPhones(['']);
    setFormEmails(['']);
    setFormSysAccount('');
    setFormSysPassword('');
    setFormShowPassword(false);
    setFormTimezone('(CDT) Central Time');
    setFormBusinessHours({
      '周一': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周二': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周三': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周四': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周五': { open: true, start: '09:00 AM', end: '10:00 PM' },
      '周六': { open: true, start: '10:00 AM', end: '08:00 PM' },
      '周日': { open: false, start: '10:00 AM', end: '06:00 PM' }
    });
    setFormTags(['Spa', 'Foot Massage']);
    setFormFeatures({
      onlineBooking: true,
      onlinePayment: false,
      reviews: true,
      membershipCard: true
    });
    setFormDataStatus('正常');
    setFormBusinessStatus('营业中');
    setFormLogo('🌿');
    setFormLogoUrl('');
    setFormBannerUrl(PRESET_BANNERS[0].url);
    setFormAbout('');
    setFormGallery([PRESET_GALLERY_PHOTOS[0].url, PRESET_GALLERY_PHOTOS[1].url, PRESET_GALLERY_PHOTOS[2].url]);
    setFormVideoUrl('');
    setFormAddress('');
    setFormCity('');
    setFormStateVal('Texas');
    setFormZipCode('');
    setFormMapShareUrl('');
    setFormMapEmbed('');
    
    setStudioOpen(true);
  };

  const openEditStore = (store: StoreItem) => {
    setEditingStoreId(store.id);
    setFormName(store.name);
    setFormSubtitle(store.subtitle);
    setFormShortName(store.shortName);
    setFormPhones(store.phones.length > 0 ? store.phones : ['']);
    setFormEmails(store.emails.length > 0 ? store.emails : ['']);
    setFormSysAccount(store.sysAccount);
    setFormSysPassword(store.sysPassword || 'ariva1234');
    setFormShowPassword(false);
    setFormTimezone(store.timezone || '(CDT) Central Time');
    setFormBusinessHours(store.businessHours);
    setFormTags(store.tags);
    setFormFeatures({ ...store.features });
    setFormDataStatus(store.dataStatus);
    setFormBusinessStatus(store.businessStatus);
    setFormLogo(store.logo);
    setFormLogoUrl(store.logoUrl || '');
    setFormBannerUrl(store.bannerUrl || PRESET_BANNERS[0].url);
    setFormAbout(store.about);
    setFormGallery(store.gallery || []);
    setFormVideoUrl(store.videoUrl || '');
    setFormAddress(store.address);
    setFormCity(store.city);
    setFormStateVal(store.state);
    setFormZipCode(store.zipCode);
    setFormMapShareUrl(store.mapShareUrl || '');
    setFormMapEmbed(store.mapEmbedIframe || '');

    setStudioOpen(true);
  };

  const handleEnterStore = (store: StoreItem) => {
    setActiveEnterStore(store);
    setShowConfirmEnter(true);
  };

  const getCurvePath = (data: number[]) => {
    if (!data || data.length === 0) return '';
    const points = data.map((val, i) => {
      const x = 40 + i * 80;
      const y = 220 - (val / 160) * 180;
      return { x, y };
    });

    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cpX1 = p0.x + 30;
      const cpY1 = p0.y;
      const cpX2 = p1.x - 30;
      const cpY2 = p1.y;
      d += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y}`;
    }
    return d;
  };

  const getGradientPath = (data: number[]) => {
    const line = getCurvePath(data);
    if (!line || !data || data.length === 0) return '';
    const idxMax = data.length - 1;
    const endX = 40 + idxMax * 80;
    return `${line} L ${endX} 220 L 40 220 Z`;
  };

  const getChartPoints = (data: number[]) => {
    if (!data) return [];
    return data.map((val, i) => {
      return {
        x: 40 + i * 80,
        y: 220 - (val / 160) * 180,
        value: val
      };
    });
  };

  const handleSaveStore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      alert('请输入门店公司名');
      return;
    }
    if (!formShortName.trim()) {
      alert('请输入唯一的商家连接短链号');
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0] + ' ' + new Date().toISOString().split('T')[1].slice(0, 8);
    const cleanedPhones = formPhones.map(p => p.trim()).filter(p => p !== '');
    const cleanedEmails = formEmails.map(e => e.trim()).filter(e => e !== '');

    if (editingStoreId !== null) {
      setStores(prev => prev.map(item => {
        if (item.id === editingStoreId) {
          return {
            ...item,
            name: formName.trim(),
            subtitle: formSubtitle.trim(),
            shortName: formShortName.trim().replace(/\s+/g, ''),
            phones: cleanedPhones.length > 0 ? cleanedPhones : [''],
            emails: cleanedEmails.length > 0 ? cleanedEmails : [''],
            sysAccount: isStoreManager ? item.sysAccount : (formSysAccount.trim() || 'operator_admin'),
            sysPassword: formSysPassword,
            timezone: formTimezone,
            businessHours: formBusinessHours,
            tags: formTags,
            features: formFeatures,
            dataStatus: formDataStatus,
            businessStatus: formBusinessStatus,
            logo: formLogo,
            logoUrl: formLogoUrl.trim(),
            bannerUrl: formBannerUrl,
            about: formAbout.trim(),
            gallery: formGallery,
            videoUrl: formVideoUrl.trim(),
            address: formAddress.trim(),
            city: formCity.trim(),
            state: formStateVal,
            zipCode: formZipCode.trim(),
            mapShareUrl: formMapShareUrl.trim(),
            mapEmbedIframe: formMapEmbed,
            createdDate: item.createdDate
          };
        }
        return item;
      }));
    } else {
      const newId = stores.length > 0 ? Math.max(...stores.map(s => s.id)) + 1 : 3251;
      const newStore: StoreItem = {
        id: newId,
        name: formName.trim(),
        subtitle: formSubtitle.trim(),
        shortName: formShortName.trim().replace(/\s+/g, ''),
        phones: cleanedPhones.length > 0 ? cleanedPhones : [''],
        emails: cleanedEmails.length > 0 ? cleanedEmails : [''],
        sysAccount: formSysAccount.trim() || 'shop_admin',
        sysPassword: formSysPassword || 'safePassword123',
        timezone: formTimezone,
        businessHours: formBusinessHours,
        tags: formTags,
        features: formFeatures,
        dataStatus: formDataStatus,
        businessStatus: formBusinessStatus,
        logo: formLogo,
        logoUrl: formLogoUrl.trim(),
        bannerUrl: formBannerUrl,
        about: formAbout.trim(),
        gallery: formGallery,
        videoUrl: formVideoUrl.trim(),
        address: formAddress.trim(),
        city: formCity.trim(),
        state: formStateVal,
        zipCode: formZipCode.trim(),
        mapShareUrl: formMapShareUrl.trim(),
        mapEmbedIframe: formMapEmbed,
        createdDate: todayStr
      };
      setStores(prev => [newStore, ...prev]);
    }

    setStudioOpen(false);
  };

  const handleDeleteStore = (id: number) => {
    if (window.confirm('确认删除该门店？删除可能影响关联的业务。')) {
      setStores(prev => prev.filter(s => s.id !== id));
    }
  };

  const filteredStores = stores.filter(st => {
    // Role-based context lockdown for STORE_MANAGER
    if (isStoreManager) {
      const allowedIds = [
        shopStoreContext.currentStoreId,
        ...shopStoreContext.branchList.map(b => b.id)
      ].filter((id): id is number => id !== null && id !== undefined);
      if (!allowedIds.includes(st.id)) {
        return false;
      }
    }
    const textMatch = st.name.toLowerCase().includes(searchText.toLowerCase()) || 
                      st.shortName.toLowerCase().includes(searchText.toLowerCase());
    const stateMatch = !searchState.trim() || st.state.toLowerCase().includes(searchState.trim().toLowerCase());
    const cityMatch = !searchCity.trim() || st.city.toLowerCase().includes(searchCity.trim().toLowerCase());
    return textMatch && stateMatch && cityMatch;
  });

  return (
    <div className="space-y-6">
      
      {/* Upper Action Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <Store className="w-5 h-5 text-[#48a1a1]" />
            门店网点管理列表
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            配置商圈专属网点及其独立的客服热线、图库海报、营业时钟、及核销业务对接账号。
          </p>
        </div>
        
        {!isStoreManager && (
          <button 
            onClick={openCreateStore}
            className="flex items-center gap-2 bg-[#48a1a1] pb-2 pt-2 px-5 rounded-lg text-sm font-semibold text-white hover:bg-[#3d8b8b] transition-all shadow-sm"
          >
            <Plus className="w-4.5 h-4.5" />
            新增门店
          </button>
        )}
      </div>

      {/* Simplified Search Boxes */}
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">主要物理州名</label>
          <input 
            type="text" 
            placeholder="州名"
            value={searchState}
            onChange={(e) => setSearchState(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">服务城市名称</label>
          <input 
            type="text" 
            placeholder="城市"
            value={searchCity}
            onChange={(e) => setSearchCity(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">门店或短链代码查询</label>
          <input 
            type="text" 
            placeholder="门店名称"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
          />
        </div>
        <div className="flex gap-2">
          <button 
            type="button"
            onClick={() => { setSearchState(''); setSearchCity(''); setSearchText(''); }}
            className="flex-1 bg-gray-100 text-gray-600 rounded-lg py-2 text-xs font-semibold hover:bg-gray-200 transition-colors"
          >
            清空重设
          </button>
          <button className="flex-1 bg-[#48a1a1] text-white rounded-lg py-2 text-xs font-semibold hover:bg-[#3d8b8b] transition-colors flex items-center justify-center gap-1">
            <Search className="w-3.5 h-3.5" />
            快速检索
          </button>
        </div>
      </div>

      {/* Main Table View */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="px-5 py-4 text-xs font-bold text-gray-500">ID</th>
                <th className="px-5 py-4 text-xs font-bold text-gray-500">门店标识</th>
                <th className="px-5 py-4 text-xs font-bold text-gray-500">外部直属代码</th>
                <th className="px-5 py-4 text-xs font-bold text-gray-500">门店公司全称</th>
                <th className="px-5 py-4 text-xs font-bold text-gray-500">具体省市地址</th>
                <th className="px-5 py-4 text-xs font-bold text-gray-500">主要联系工具</th>
                <th className="px-5 py-4 text-xs font-bold text-gray-500">数据状态</th>
                <th className="px-5 py-4 text-xs font-bold text-gray-500">营业状态</th>
                <th className="px-5 py-4 text-xs font-bold text-gray-500">同步于</th>
                <th className="px-5 py-4 text-xs font-bold text-gray-500">网点配置</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 text-gray-700">
              {filteredStores.map((row, index) => (
                <tr key={row.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3.5 text-xs font-mono font-bold text-slate-400">{row.id}</td>
                  <td className="px-5 py-3.5 text-xs">
                    {row.logoUrl ? (
                      <img 
                        src={row.logoUrl} 
                        alt="logo" 
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-xl object-cover ring-2 ring-slate-100 shadow-xs" 
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-lg shadow-xs ring-2 ring-slate-100">
                        {row.logo || '🌿'}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-xs">
                    <span className="bg-sky-50 text-sky-700 border border-sky-100 rounded-md px-2 py-0.5 font-mono font-bold">
                      {row.shortName}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs">
                    <div className="font-bold text-gray-900">{row.name}</div>
                    {row.subtitle && (
                      <div className="text-[10px] text-gray-400 mt-0.5 max-w-[190px] truncate">{row.subtitle}</div>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-gray-500 max-w-[200px]">
                    <div className="truncate font-semibold text-gray-700">{row.address}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{row.city}, {row.state} {row.zipCode}</div>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-600 space-y-0.5">
                    <div className="flex items-center gap-1"><Phone className="w-3 h-3 text-[#48a1a1] shrink-0" /> {row.phones[0]}</div>
                    {row.emails[0] && (
                      <div className="flex items-center gap-1 text-[10px] text-slate-400">
                        <Mail className="w-2.5 h-2.5 text-slate-400 shrink-0" /> {row.emails[0]}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-xs">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-semibold",
                      row.dataStatus === '正常' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"
                    )}>
                      {row.dataStatus}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-semibold",
                      row.businessStatus === '营业中' ? "bg-cyan-50 text-cyan-700 border border-cyan-100" : "bg-amber-50 text-amber-700 border border-amber-100"
                    )}>
                      {row.businessStatus}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs font-mono text-slate-400">{row.createdDate}</td>
                  <td className="px-5 py-3.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      <button 
                        onClick={() => openEditStore(row)}
                        className="px-3 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold transition-all hover:border-[#48a1a1] hover:text-[#48a1a1] cursor-pointer"
                        style={{ borderRadius: '0px' }}
                      >
                        编辑配置
                      </button>
                      <button 
                        onClick={() => handleEnterStore(row)}
                        className="px-3 py-1 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white border border-transparent font-semibold transition-all cursor-pointer shadow-xs active:scale-[0.98]"
                        style={{ borderRadius: '0px' }}
                      >
                        进入
                      </button>
                      {!isStoreManager && (
                        <button 
                          onClick={() => handleDeleteStore(row.id)}
                          className="px-2 py-1 bg-white hover:bg-red-50 text-red-500 border border-slate-200 hover:border-red-100 transition-colors font-semibold cursor-pointer"
                          style={{ borderRadius: '0px' }}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* FULL-WIDESCREEN CONFIGURATION STUDIO AND OPERATOR SIMULATOR */}
      <AnimatePresence>
        {studioOpen && (
          <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
            <motion.div 
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
              className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-7xl h-[92vh] overflow-hidden flex flex-col"
            >
              
              {/* Studio Header Bar */}
              <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-xs shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[#48a1a1]/10 flex items-center justify-center">
                    <Store className="w-4.5 h-4.5 text-[#48a1a1]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">
                      {editingStoreId ? '编辑门店网点配置' : '录入全新直营店网点档案'}
                    </h3>
                    <p className="text-[10px] text-gray-400 mt-0.5">请在左侧区域垂直下滑完成所有属性设定，右侧手机模型实时渲染顾客视察品牌视觉。</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs bg-slate-100 text-[#48a1a1] font-bold px-2 py-1 rounded font-mono border border-slate-200/40">
                    短链代码: {formShortName || '未确定'}
                  </span>
                  <button 
                    onClick={() => setStudioOpen(false)}
                    className="p-1.5 hover:bg-gray-100 text-gray-400 rounded-full transition-colors"
                  >
                    <X className="w-4.5 h-4.5" />
                  </button>
                </div>
              </div>

              {/* Swapped layout: 
                  - LEFT: Consolidated vertically scrollable editing form 
                  - RIGHT: Interactive smartphone app preview (strictly in English) */}
              <div className="flex-1 flex overflow-hidden">
                
                {/* LEFT COLUMN: Consolidated Contiguous Form */}
                <form 
                  onSubmit={handleSaveStore}
                  className="flex-1 bg-white p-8 overflow-y-auto space-y-8 border-r border-slate-200/60"
                >
                  {isStoreManager && (
                    <div className="flex border-b border-slate-200 shrink-0 bg-slate-50 p-1 mb-4 select-none" style={{ borderRadius: '0px' }}>
                      <button
                        type="button"
                        onClick={() => setActiveStudioTab('profile')}
                        style={{ borderRadius: '0px' }}
                        className={`flex-1 text-center py-2 text-xs font-bold transition-all rounded-none cursor-pointer ${
                          activeStudioTab === 'profile'
                            ? 'bg-white text-[#48a1a1] shadow-xs border border-gray-200/50 font-extrabold'
                            : 'text-gray-550 hover:text-gray-900 hover:bg-white/45'
                        }`}
                      >
                        🏪 门店环境设置 (Store Profile)
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveStudioTab('technicians')}
                        style={{ borderRadius: '0px' }}
                        className={`flex-1 text-center py-2 text-xs font-bold transition-all rounded-none cursor-pointer ${
                          activeStudioTab === 'technicians'
                            ? 'bg-white text-[#48a1a1] shadow-xs border border-gray-200/50 font-extrabold'
                            : 'text-gray-550 hover:text-gray-900 hover:bg-white/45'
                        }`}
                      >
                        🧖‍♂️ 技师员工管理 (Technicians)
                      </button>
                    </div>
                  )}

                  {isStoreManager && activeStudioTab === 'technicians' ? (
                    <div className="space-y-6 py-2">
                      <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-bold text-gray-850 flex items-center gap-2">
                            <span className="w-5 h-5 bg-[#48a1a1]/10 text-[#48a1a1] flex items-center justify-center text-xs font-mono font-bold" style={{ borderRadius: '0px' }}>MD</span>
                            分店合作理疗技师排班
                          </h4>
                          <p className="text-[10px] text-gray-400 mt-0.5">登记和管理该门店名下直接合作的理疗师/技师姓名、职称、主攻项目及在线值班状态。</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const name = prompt('登记理疗技师：请输入姓名');
                            if (!name) return;
                            const title = prompt('请输入职称/职称 (例如: 特级精油芳疗师)', '特级精油芳疗师');
                            const specsStr = prompt('请输入擅长項目/主攻标签(多个请用半角逗号分隔)', '精油热石, 头部经络');
                            
                            const newTech = {
                              id: Date.now(),
                              name: name.trim(),
                              avatar: Math.random() > 0.5 ? '🧖‍♀️' : '🧖‍♂️',
                              title: title || '注册理疗芳疗师',
                              experience: '8年从业经验',
                              specialties: specsStr ? specsStr.split(',').map(s => s.trim()) : ['精油热石', '肩颈舒缓'],
                              rating: 4.9,
                              status: '空闲'
                            };
                            setTechnicians(prev => [...prev, newTech]);
                          }}
                          style={{ borderRadius: '0px' }}
                          className="px-3 py-1.5 bg-[#48a1a1] text-white hover:bg-[#3d8b8b] text-xs font-bold transition-all flex items-center gap-1 cursor-pointer rounded-none"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          新增技师登记
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {technicians.map((tech) => (
                          <div 
                            key={tech.id} 
                            style={{ borderRadius: '0px' }}
                            className="bg-white border border-slate-200/80 p-4 space-y-3 relative shadow-xs rounded-none hover:border-[#48a1a1]/30 transition-colors"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`确认注销并解除与技师 [${tech.name}] 的入驻绑定吗？`)) {
                                  setTechnicians(prev => prev.filter(t => t.id !== tech.id));
                                }
                              }}
                              className="absolute top-3 right-3 text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>

                            <div className="flex items-start gap-3">
                              <div className="w-11 h-11 bg-slate-50 flex items-center justify-center text-2xl border border-slate-100 shrink-0" style={{ borderRadius: '0px' }}>
                                {tech.avatar}
                              </div>
                              <div className="space-y-0.5">
                                <div className="text-xs font-extrabold text-slate-800">{tech.name}</div>
                                <div className="text-[10px] text-[#48a1a1] font-bold">{tech.title}</div>
                                <div className="text-[9px] text-zinc-400 font-semibold">{tech.experience}</div>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-1">
                              {tech.specialties.map((spec: string, idx: number) => (
                                <span 
                                  key={idx} 
                                  style={{ borderRadius: '0px' }}
                                  className="bg-slate-50 border border-slate-150 text-[9px] font-bold text-slate-550 px-1.5 py-0.5"
                                >
                                  {spec}
                                </span>
                              ))}
                            </div>

                            <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-slate-100">
                              <div className="flex items-center gap-1 font-semibold text-slate-500">
                                <span className="text-amber-500">★ {tech.rating}</span>
                                <span>(40+ 次好评)</span>
                              </div>

                              <div className="flex items-center gap-1">
                                <select
                                  value={tech.status}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setTechnicians(prev => prev.map(t => t.id === tech.id ? { ...t, status: value } : t));
                                  }}
                                  className="bg-gray-50 border border-gray-200 text-[10px] px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#48a1a1] rounded-none cursor-pointer"
                                  style={{ borderRadius: '0px' }}
                                >
                                  <option value="空闲">🟢 空闲中</option>
                                  <option value="服务中">🟡 服务中</option>
                                  <option value="休息中">🔴 休息中</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* SECTION 1: 主要基本资料与权限账号 */}
                      <div className="space-y-4">
                    <div className="border-b border-slate-100 pb-2">
                      <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                        <span className="w-5 h-5 rounded bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs">1</span>
                        基本信息与账号管理
                      </h4>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-600 block">
                          <span className="text-red-500">*</span> 商家公司名称
                        </label>
                        <input 
                          type="text"
                          required
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 text-sm text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                          placeholder="输入英文门店品牌名称"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-600 block">
                          <span className="text-red-500">*</span> 直链代码
                        </label>
                        <input 
                          type="text"
                          required
                          value={formShortName}
                          onChange={(e) => setFormShortName(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 text-sm text-slate-800 font-semibold font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                          placeholder="输入用于连接卡券与前端导流的短码"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-600 block">亮点宣传口号</label>
                      <input 
                        type="text"
                        value={formSubtitle}
                        onChange={(e) => setFormSubtitle(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 text-sm text-slate-800"
                        placeholder="输入在顾客移动端海报显眼的副标题亮点"
                      />
                    </div>

                    {/* Sys account for operators */}
                    <div className="grid grid-cols-2 gap-4 bg-slate-50/50 p-3.5 rounded-xl border border-slate-100">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-600 block">登录账号</label>
                        <input 
                          type="text"
                          value={formSysAccount}
                          onChange={(e) => setFormSysAccount(e.target.value)}
                          disabled={isStoreManager}
                          style={{ borderRadius: '0px' }}
                          className={cn(
                            "w-full border px-3.5 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20",
                            isStoreManager 
                              ? "bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200" 
                              : "bg-white border-slate-200 text-slate-800"
                          )}
                          placeholder="输入该分店核销系统的登录名"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-600 block">登录密码</label>
                        <div className="relative">
                          <input 
                            type={formShowPassword ? 'text' : 'password'}
                            value={formSysPassword}
                            onChange={(e) => setFormSysPassword(e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded-lg pl-3.5 pr-10 py-2 text-sm text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                            placeholder="输入密码"
                          />
                          <button
                            type="button"
                            onClick={() => setFormShowPassword(!formShowPassword)}
                            className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                          >
                            {formShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Multiple Phone Numbers and Emails */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-gray-600">专属客服电话</label>
                          <button
                            type="button"
                            onClick={addPhoneField}
                            className="text-xs text-[#48a1a1] hover:underline font-bold"
                          >
                            + 添加号码
                          </button>
                        </div>
                        {formPhones.map((phone, idx) => (
                          <div key={idx} className="flex gap-1.5">
                            <input 
                              type="text"
                              value={phone}
                              onChange={(e) => updatePhoneField(idx, e.target.value)}
                              className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-1.5 text-xs text-slate-800 focus:outline-none"
                              placeholder="主要联系网点电话"
                            />
                            <button
                              type="button"
                              onClick={() => removePhoneField(idx)}
                              className="text-red-400 hover:text-red-600 text-xs px-1"
                            >
                              删除
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-gray-600">专属客服邮箱</label>
                          <button
                            type="button"
                            onClick={addEmailField}
                            className="text-xs text-[#48a1a1] hover:underline font-bold"
                          >
                            + 添加邮箱
                          </button>
                        </div>
                        {formEmails.map((email, idx) => (
                          <div key={idx} className="flex gap-1.5">
                            <input 
                              type="email"
                              value={email}
                              onChange={(e) => updateEmailField(idx, e.target.value)}
                              className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-1.5 text-xs text-slate-800 focus:outline-none"
                              placeholder="电子信箱"
                            />
                            <button
                              type="button"
                              onClick={() => removeEmailField(idx)}
                              className="text-red-400 hover:text-red-600 text-xs px-1"
                            >
                              删除
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* SECTION 2: 营业时间及状态、功能配置 */}
                  <div className="space-y-4">
                    <div className="border-b border-slate-100 pb-2">
                      <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                        <span className="w-5 h-5 rounded bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs">2</span>
                        营业与功能服务配置
                      </h4>
                    </div>

                    <div className="grid grid-cols-3 gap-4 bg-slate-50/40 p-4 rounded-xl border border-slate-100">
                      <div>
                        <label className="text-xs font-bold text-gray-600 block mb-1">所在时区</label>
                        <select 
                          value={formTimezone}
                          onChange={(e) => setFormTimezone(e.target.value)}
                          className="bg-white border border-slate-200 rounded-lg text-xs p-2 w-full focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20 font-semibold"
                        >
                          <option value="(EDT) Eastern Time">东部时间 (Eastern Time)</option>
                          <option value="(CDT) Central Time">中部时间 (Central Time)</option>
                          <option value="(MDT) Mountain Time">山地时间 (Mountain Time)</option>
                          <option value="(PDT) Pacific Time">太平洋时间 (Pacific Time)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-gray-600 block mb-1">数据状态</label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setFormDataStatus('正常')}
                            className={cn(
                              "flex-1 text-center py-1.5 text-xs rounded-lg font-bold border",
                              formDataStatus === '正常' 
                                ? "bg-emerald-50 border-emerald-300 text-emerald-700" 
                                : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                            )}
                          >
                            活动正常
                          </button>
                          <button
                            type="button"
                            onClick={() => setFormDataStatus('关闭')}
                            className={cn(
                              "flex-1 text-center py-1.5 text-xs rounded-lg font-bold border",
                              formDataStatus === '关闭' 
                                ? "bg-red-50 border-red-200 text-red-600" 
                                : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                            )}
                          >
                            已停用
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-gray-600 block mb-1">实时运营状态</label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setFormBusinessStatus('营业中')}
                            className={cn(
                              "flex-1 text-center py-1.5 text-xs rounded-lg font-bold border",
                              formBusinessStatus === '营业中' 
                                ? "bg-cyan-50 border-cyan-300 text-cyan-700" 
                                : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                            )}
                          >
                            正在营业
                          </button>
                          <button
                            type="button"
                            onClick={() => setFormBusinessStatus('休息中')}
                            className={cn(
                              "flex-1 text-center py-1.5 text-xs rounded-lg font-bold border",
                              formBusinessStatus === '休息中' 
                                ? "bg-amber-50 border-amber-200 text-amber-700" 
                                : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                            )}
                          >
                            暂停打烊
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Features enabled checkboxes */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-600 block">开启的功能板块</label>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { key: 'onlineBooking', label: '在线直接预约' },
                          { key: 'onlinePayment', label: '在线担保付款' },
                          { key: 'reviews', label: '开通真实评价' },
                          { key: 'membershipCard', label: '对接会员优惠卡' }
                        ].map((feat) => (
                          <label 
                            key={feat.key}
                            className={cn(
                              "flex items-center gap-2 border rounded-lg p-2.5 cursor-pointer hover:bg-slate-50 select-none",
                              formFeatures[feat.key as keyof typeof formFeatures]
                                ? "border-[#48a1a1]/40 bg-[#48a1a1]/5 hover:bg-[#48a1a1]/10 text-slate-800"
                                : "border-slate-200 text-slate-500 bg-white"
                            )}
                          >
                            <input 
                              type="checkbox"
                              checked={formFeatures[feat.key as keyof typeof formFeatures]}
                              onChange={(e) => setFormFeatures({
                                ...formFeatures,
                                [feat.key]: e.target.checked
                              })}
                              className="rounded text-[#48a1a1] focus:ring-[#48a1a1]"
                            />
                            <span className="text-xs font-semibold">{feat.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Interaction Tags manager */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-600 block">品牌或服务特色标签</label>
                      <div className="flex flex-wrap gap-1.5 p-3.5 bg-slate-50 border border-slate-200/50 rounded-xl">
                        {formTags.map((tag, idx) => (
                          <span 
                            key={idx}
                            className="bg-white border border-slate-200 rounded-full px-2.5 py-0.5 text-xs text-slate-700 flex items-center gap-1 shadow-2xs"
                          >
                            {tag}
                            <button
                              type="button"
                              onClick={() => handleRemoveTag(idx)}
                              className="text-gray-400 hover:text-red-500 rounded-full"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input 
                          type="text"
                          placeholder="回车键确认保存"
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={handleAddTag}
                          className="bg-transparent text-xs text-slate-700 outline-none placeholder-slate-400 min-w-[120px]"
                        />
                      </div>
                    </div>

                    {/* Business Hours Table with SYNC Button */}
                    <div className="space-y-3 pt-1">
                      <div className="flex items-center justify-between bg-[#48a1a1]/5 p-3 rounded-lg border border-[#48a1a1]/20">
                        <div>
                          <p className="text-xs font-semibold text-slate-800">营业时间表</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">更改周一的时段后点击右侧按钮，快捷将该作息同步至整周。</p>
                        </div>
                        <button
                          type="button"
                          onClick={handleSyncWeekHours}
                          className="bg-[#48a1a1] hover:bg-[#3d8b8b] text-white text-xs font-semibold px-4 py-1.5 rounded-md transition-all shadow-2xs"
                        >
                          同步全周
                        </button>
                      </div>

                      <div className="border border-slate-200/60 rounded-xl overflow-hidden bg-white">
                        {WEEKDAYS.map((day) => {
                          const dh = formBusinessHours[day];
                          return (
                            <div key={day} className="flex items-center justify-between px-4 py-2 border-b border-gray-100 last:border-b-0 hover:bg-slate-50/60">
                              <div className="flex items-center gap-3">
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input 
                                    type="checkbox"
                                    checked={dh.open}
                                    onChange={(e) => {
                                      setFormBusinessHours({
                                        ...formBusinessHours,
                                        [day]: { ...dh, open: e.target.checked }
                                      });
                                    }}
                                    className="sr-only peer"
                                  />
                                  <div className="w-8 h-4 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#48a1a1]" />
                                </label>
                                <span className="text-xs font-bold text-gray-700">{day}</span>
                                <span className={cn(
                                  "text-[10px] font-bold px-1.5 rounded",
                                  dh.open ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-400"
                                )}>
                                  {dh.open ? '营业' : '闭店'}
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                <select
                                  disabled={!dh.open}
                                  value={dh.start}
                                  onChange={(e) => {
                                    setFormBusinessHours({
                                      ...formBusinessHours,
                                      [day]: { ...dh, start: e.target.value }
                                    });
                                  }}
                                  className="border border-slate-200 rounded text-xs p-1 bg-white disabled:bg-gray-50 focus:outline-none"
                                >
                                  {TIME_OPTIONS.map(time => <option key={time} value={time}>{time}</option>)}
                                </select>
                                <span className="text-xs text-gray-400">—</span>
                                <select
                                  disabled={!dh.open}
                                  value={dh.end}
                                  onChange={(e) => {
                                    setFormBusinessHours({
                                      ...formBusinessHours,
                                      [day]: { ...dh, end: e.target.value }
                                    });
                                  }}
                                  className="border border-slate-200 rounded text-xs p-1 bg-white disabled:bg-gray-50 focus:outline-none"
                                >
                                  {TIME_OPTIONS.map(time => <option key={time} value={time}>{time}</option>)}
                                </select>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* SECTION 3: 宣传海报图册、画廊、文字介绍 (IMAGE 1-4 COMPOSITION STYLING) */}
                  <div className="space-y-4">
                    <div className="border-b border-slate-100 pb-2">
                      <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                        <span className="w-5 h-5 rounded bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs">3</span>
                        移动端品牌多媒体与橱窗
                      </h4>
                    </div>

                    {/* Logo preset selector and custom text inputs */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5 p-3.5 bg-slate-50 border border-slate-100 rounded-xl">
                        <label className="text-xs font-bold text-gray-700 block mb-1">精美图标</label>
                        <div className="flex gap-2 mb-2">
                          {PRESET_LOGOS.map((lg) => (
                            <button
                              key={lg.char}
                              type="button"
                              onClick={() => { setFormLogo(lg.char); setFormLogoUrl(''); }}
                              className={cn(
                                "w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all border",
                                formLogo === lg.char && !formLogoUrl
                                  ? "bg-slate-800 border-slate-800 text-white scale-105"
                                  : "bg-white border-slate-200 hover:border-slate-300"
                              )}
                              title={lg.name}
                            >
                              {lg.char}
                            </button>
                          ))}
                        </div>
                        <input 
                          type="text"
                          value={formLogoUrl}
                          onChange={(e) => setFormLogoUrl(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
                          placeholder="输入自定图标网络在线地址（可留空）"
                        />
                      </div>

                      <div className="space-y-1.5 p-3.5 bg-slate-50 border border-slate-100 rounded-xl">
                        <label className="text-xs font-bold text-gray-700 block mb-1">大幅宣传海报</label>
                        <div className="flex gap-2 mb-2">
                          {PRESET_BANNERS.map((bn, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setFormBannerUrl(bn.url)}
                              className={cn(
                                "px-2 py-1 rounded text-[10px] font-bold transition-all border",
                                formBannerUrl === bn.url
                                  ? "bg-slate-800 border-slate-800 text-white"
                                  : "bg-white border-slate-200 hover:border-slate-300 text-slate-600"
                              )}
                            >
                              {bn.name}
                            </button>
                          ))}
                        </div>
                        <input 
                          type="text"
                          value={formBannerUrl}
                          onChange={(e) => setFormBannerUrl(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
                          placeholder="海报图片真实URL地址"
                        />
                      </div>
                    </div>

                    {/* Integrated dynamic image gallery manager (matching layout image 1/2/3/4) */}
                    <div className="space-y-2 p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-xs font-bold text-gray-700 block">品牌相册与客群实机馆橱窗</label>
                          <span className="text-[10px] text-gray-500 block">快速点选推荐图库加入画廊，或者直接按上传模拟器扩充相片。</span>
                        </div>
                        <button
                          type="button"
                          onClick={triggerUploadMockFile}
                          className="text-xs bg-[#48a1a1] text-white hover:bg-[#3d8b8b] px-3 py-1 font-semibold rounded-md transition-all shadow-2xs"
                        >
                          + 上传画廊相片
                        </button>
                      </div>

                      {/* Stock selectable images Grid (Images style composition UI) */}
                      <div className="grid grid-cols-4 gap-2.5 pt-2">
                        {PRESET_GALLERY_PHOTOS.map((g) => {
                          const active = formGallery.includes(g.url);
                          return (
                            <div 
                              key={g.id}
                              onClick={() => toggleGalleryPhoto(g.url)}
                              className={cn(
                                "group relative h-20 rounded-lg overflow-hidden border cursor-pointer transition-all shadow-2xs select-none",
                                active ? "border-emerald-500 ring-2 ring-emerald-400/20" : "border-slate-200 hover:border-slate-400"
                              )}
                            >
                              <img src={g.url} alt="preset" referrerPolicy="no-referrer" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                              <div className="absolute inset-0 bg-black/10 group-hover:bg-black/20" />
                              
                              <div className="absolute bottom-1 left-1.5 right-1.5 bg-black/60 px-1 py-0.5 rounded text-[8px] text-white font-bold truncate">
                                {g.title}
                              </div>

                              {active && (
                                <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow">
                                  <Check className="w-2.5 h-2.5 stroke-[4]" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Display of currently chosen gallery URLs */}
                      {formGallery.length > 0 && (
                        <div className="mt-3 pt-2 border-t border-slate-200/40 text-[10px] text-slate-500 space-y-1">
                          <p className="font-bold">当前已勾选 {formGallery.length} 张相片（右侧实机实时同步）：</p>
                          <div className="max-h-20 overflow-y-auto font-mono text-[9px] bg-white p-2 rounded-lg border divide-y divide-slate-50">
                            {formGallery.map((url, idx) => (
                              <div key={idx} className="py-0.5 flex justify-between items-center gap-2">
                                <span className="truncate">{url}</span>
                                <button type="button" onClick={() => toggleGalleryPhoto(url)} className="text-red-500 hover:underline shrink-0 font-bold">撤下</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Promo video link */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-700 block">宣传视频 MP4 链接</label>
                      <input 
                        type="text"
                        value={formVideoUrl}
                        onChange={(e) => setFormVideoUrl(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 text-xs text-slate-800"
                        placeholder="输入线上播放宣传影片地址"
                      />
                    </div>

                    {/* About markdown text description */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-700 block">详细网点长篇简介</label>
                      <textarea
                        rows={3}
                        value={formAbout}
                        onChange={(e) => setFormAbout(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/25"
                        placeholder="输入更详尽关于内容描述以丰富门店档、并提高谷歌收录转化率"
                      />
                    </div>
                  </div>

                  {/* SECTION 4: 网点物理位置与谷歌地图配套 */}
                  <div className="space-y-4">
                    <div className="border-b border-slate-100 pb-2">
                      <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                        <span className="w-5 h-5 rounded bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs">4</span>
                        地理位置 & Google 地图配置
                      </h4>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-600 block">街道门牌号详细地址</label>
                      <input 
                        type="text"
                        value={formAddress}
                        onChange={(e) => setFormAddress(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 text-xs text-slate-800"
                        placeholder="录入门牌名称"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-600 block">所在城市</label>
                        <input 
                          type="text"
                          value={formCity}
                          onChange={(e) => setFormCity(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 text-xs text-slate-800"
                          placeholder="城市全名"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-600 block">所在州份/省区</label>
                        <input 
                          type="text"
                          value={formStateVal}
                          onChange={(e) => setFormStateVal(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 text-xs text-slate-800 animate-none"
                          placeholder="州份/省称"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-600 block">邮政编码</label>
                        <input 
                          type="text"
                          value={formZipCode}
                          onChange={(e) => setFormZipCode(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 text-xs text-slate-800"
                          placeholder="五位数ZIP码"
                        />
                      </div>
                    </div>

                    <div className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-700 block">谷歌官方分享地址</label>
                        <input 
                          type="text"
                          value={formMapShareUrl}
                          onChange={(e) => setFormMapShareUrl(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800"
                          placeholder="来自谷歌地图分享按键后的短路由链接地址"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-700 block">谷歌嵌入式地图代码</label>
                        <textarea
                          rows={2}
                          value={formMapEmbed}
                          onChange={(e) => setFormMapEmbed(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-mono"
                          placeholder="输入谷歌分享中的地图嵌入 HTML 网页片段代码"
                        />
                      </div>

                      {/* Map live preview box mock */}
                      <div className="rounded-lg overflow-hidden border border-slate-200/60 bg-slate-100 relative shadow-inner overflow-hidden">
                        <div className="text-center p-6 text-slate-400">
                          <MapPin className="w-5 h-5 mx-auto mb-1 text-slate-400 shrink-0" />
                          <span className="text-[10px] font-bold block">[ Google Maps 导航嵌入视点 ]</span>
                          <span className="text-[8px] text-slate-400 block mt-1">目前定位: {formCity || '未命名城市'} (坐标解析就绪)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  </>
                  )}

                  {/* Form Submission Action Row */}
                  <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 shrink-0">
                    <button
                      type="button"
                      onClick={() => setStudioOpen(false)}
                      className="px-6 py-2 border border-slate-200 text-slate-500 rounded-lg text-xs font-bold hover:bg-slate-50 transition-all"
                    >
                      取消录入
                    </button>
                    <button
                      type="submit"
                      className="px-8 py-2 bg-[#48a1a1] text-white hover:bg-[#3d8b8b] rounded-lg text-xs font-bold transition-all shadow-sm"
                    >
                      保存此直营网点配置
                    </button>
                  </div>
                </form>

                {/* RIGHT COLUMN: CUSTOMER APP SMARTPHONE PREVIEW PANEL (Strictly English for customers) */}
                <div className="w-[360px] max-w-[360px] bg-slate-100 border-l border-slate-200/60 flex flex-col justify-center items-center p-4 overflow-y-auto select-none hidden lg:flex shrink-0">
                  <div className="bg-slate-900 w-[310px] h-[550px] rounded-[36px] p-2.5 shadow-xl border-4 border-slate-800 relative flex flex-col overflow-hidden ring-4 ring-slate-800/10">
                    
                    {/* Phone audio speaker slit & custom front camera dot */}
                    <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-28 h-5 bg-slate-900 rounded-full z-10 flex items-center justify-around px-2.5">
                      <div className="w-1.5 h-1.5 bg-slate-800 rounded-full" />
                      <div className="w-10 h-1 bg-slate-800 rounded-full" />
                    </div>

                    {/* Simulating real mobile viewport */}
                    <div className="flex-1 bg-white rounded-[26px] overflow-y-auto text-slate-800 flex flex-col text-xs scrollbar-none pb-4">
                      
                      {/* Brand Hero Banner */}
                      <div className="h-28 w-full relative shrink-0 bg-slate-200">
                        {formBannerUrl ? (
                          <img 
                            src={formBannerUrl} 
                            alt="banner" 
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover" 
                          />
                        ) : (
                          <div className="w-full h-full bg-slate-300" />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
                        
                        <span className="absolute top-3 right-3 bg-[#48a1a1] text-white text-[8px] font-bold px-1.5 py-0.5 rounded uppercase font-mono tracking-tight shadow-xs">
                          {formShortName || 'ARIVASPA'}
                        </span>
                      </div>

                      {/* Floating Identity Area */}
                      <div className="px-3.5 -mt-6 relative z-10 space-y-1.5 mb-2.5">
                        <div className="flex items-end justify-between">
                          <div className="w-12 h-12 rounded-full border border-white bg-white shadow-md flex items-center justify-center text-2xl overflow-hidden font-bold shrink-0">
                            {formLogoUrl ? (
                              <img src={formLogoUrl} alt="logo" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                            ) : (
                              formLogo || '🌿'
                            )}
                          </div>
                          
                          <div className={cn(
                            "px-2 py-0.5 rounded-full text-[8px] font-bold text-white shadow-xs",
                            formBusinessStatus === '营业中' ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                          )}>
                            {formBusinessStatus === '营业中' ? 'OPEN NOW' : 'CLOSED'}
                          </div>
                        </div>

                        <div>
                          <h4 className="text-slate-900 font-bold text-sm tracking-tight truncate">
                            {formName || 'Ariva Spa Littleton'}
                          </h4>
                          <p className="text-[9px] text-slate-400 italic font-medium line-clamp-1 mt-0.5">
                            {formSubtitle || 'Relax & Rejuvenate Your Body'}
                          </p>
                        </div>
                      </div>

                      {/* Capability Flags of App */}
                      <div className="px-3.5 flex flex-wrap gap-1">
                        {formFeatures.onlineBooking && (
                          <span className="text-[8px] bg-sky-50 text-sky-600 font-bold border border-sky-100 rounded px-1 flex items-center gap-0.5">
                            ✓ Booking
                          </span>
                        )}
                        {formFeatures.onlinePayment && (
                          <span className="text-[8px] bg-emerald-50 text-emerald-600 font-bold border border-emerald-100 rounded px-1 flex items-center gap-0.5">
                            ✓ Checkout
                          </span>
                        )}
                        {formFeatures.reviews && (
                          <span className="text-[8px] bg-pink-50 text-pink-600 font-bold border border-pink-100 rounded px-1 flex items-center gap-0.5">
                            ✓ Reviews
                          </span>
                        )}
                        {formFeatures.membershipCard && (
                          <span className="text-[8px] bg-purple-50 text-purple-600 font-bold border border-purple-100 rounded px-1 flex items-center gap-0.5">
                            ✓ Member Card
                          </span>
                        )}
                      </div>

                      {/* Brand Info */}
                      <div className="px-3.5 mt-3 space-y-1">
                        <div className="text-[8px] font-bold text-slate-400 tracking-widest uppercase">Brand About</div>
                        <p className="text-[9px] text-slate-600 leading-relaxed bg-slate-50 p-2 rounded-lg line-clamp-3">
                          {formAbout || 'We provide excellent physical therapy & classic Swedish aromatherapy oils with over 15 years certified therapists.'}
                        </p>
                      </div>

                      {/* Stock Selection Real-Time Gallery Preview */}
                      <div className="px-3.5 mt-3 space-y-1">
                        <div className="text-[8px] font-bold text-slate-400 tracking-widest uppercase">Service Gallery</div>
                        {formGallery.length === 0 ? (
                          <p className="text-[9px] text-slate-400">No photos in customer gallery yet.</p>
                        ) : (
                          <div className="grid grid-cols-3 gap-1">
                            {formGallery.slice(0, 6).map((img, idx) => (
                              <div key={idx} className="h-10 rounded-md overflow-hidden bg-slate-100 relative border border-slate-100 shadow-2xs">
                                <img src={img} alt="preview" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Brand Address Map details */}
                      <div className="px-3.5 mt-3 space-y-0.5">
                        <div className="text-[8px] font-bold text-slate-400 tracking-widest uppercase">Address Map</div>
                        <div className="flex items-start gap-1 text-slate-700 bg-slate-50 p-1.5 rounded border border-slate-100">
                          <MapPin className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold text-[9px] leading-tight text-slate-800">{formAddress || '6728 W Coal Mine Ave'}</p>
                            <p className="text-[8px] text-slate-400 font-semibold">{formCity || 'Littleton'}, {formStateVal || 'Colorado'} {formZipCode || '80123'}</p>
                          </div>
                        </div>
                      </div>

                      {/* Customer contact channels */}
                      <div className="px-3.5 mt-3 space-y-1">
                        <div className="text-[8px] font-bold text-slate-400 tracking-widest uppercase">Direct Contact</div>
                        <div className="space-y-0.5 text-slate-600 font-bold text-[9px]">
                          {formPhones.filter(p => p !== '').map((phone, idx) => (
                            <div key={idx} className="flex items-center gap-1">
                              <Phone className="w-2.5 h-2.5 text-[#48a1a1] shrink-0" />
                              <span>{phone}</span>
                            </div>
                          ))}
                          {formEmails.filter(m => m !== '').map((email, idx) => (
                            <div key={idx} className="flex items-center gap-1">
                              <Mail className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                              <span className="truncate">{email}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>
                  </div>
                </div>

              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 1. Enter Store Confirmation Modal */}
      {showConfirmEnter && activeEnterStore && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white border-2 border-slate-900 w-full max-w-sm flex flex-col box-sharp" style={{ borderRadius: 0 }}>
            <div className="bg-[#1e293b] text-white px-4 py-2.5 flex items-center justify-between border-b border-slate-950" style={{ borderRadius: 0 }}>
              <span className="text-xs font-black tracking-wider uppercase">提示</span>
              <button onClick={() => setShowConfirmEnter(false)} className="text-gray-400 hover:text-white font-bold text-base cursor-pointer">×</button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <p className="leading-relaxed text-gray-700 font-bold">是否确认进入 [{activeEnterStore.name}] 商家端后台</p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button 
                  type="button"
                  onClick={() => setShowConfirmEnter(false)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-700 font-bold cursor-pointer transition-colors"
                  style={{ borderRadius: 0 }}
                >
                  取消
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    setShowConfirmEnter(false);
                    setShowStatsDialog(true);
                  }}
                  className="px-4 py-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white font-bold cursor-pointer transition-colors"
                  style={{ borderRadius: 0 }}
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Interactive Store Statistics Dialog (Possessed sandbox) */}
      {showStatsDialog && activeEnterStore && currentBranch && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto font-sans text-gray-800">
          <div className="bg-white border-2 border-slate-950 shadow-2xl w-full max-w-5xl flex flex-col box-sharp relative animate-in fade-in zoom-in duration-200" style={{ borderRadius: 0 }}>
            
            {/* Top Session Control Ribbon */}
            <div className="bg-[#1e293b] text-white px-6 py-3.5 flex items-center justify-between border-b border-slate-950" style={{ borderRadius: 0 }}>
              <div className="flex items-center gap-2.5">
                <span className="inline-block w-2.5 h-2.5 bg-emerald-500 animate-pulse" style={{ borderRadius: 0 }}></span>
                <span className="text-xs font-black uppercase tracking-widest font-mono text-emerald-400">POSSESSED SESSION</span>
                <span className="text-slate-500 font-mono">|</span>
                <p className="text-[11px] font-semibold text-slate-300 line-clamp-1">
                  管理员专线附身沙盒：当前正在以分店运营官角色监管该实体的全部财务、客户流量与折线记录。
                </p>
              </div>
              
              <div className="flex items-center gap-4 text-xs font-bold shrink-0">
                <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 px-3 py-1 text-slate-200 uppercase font-mono tracking-wider" style={{ borderRadius: 0 }}>
                  <span>STORE-ID:</span>
                  <span className="text-emerald-400 font-black">{activeEnterStore.id}</span>
                </div>
                
                <div className="flex items-center gap-2 bg-[#48a1a1]/15 border border-[#48a1a1]/35 pl-3.5 pr-3 py-1 text-emerald-300 relative" style={{ borderRadius: 0 }}>
                  <span className="select-none text-[11px] font-extrabold">欢迎回来, {activeEnterStore.name}</span>
                </div>
              </div>
            </div>

            {/* Main Statistics Body Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 border-b border-slate-200">
              
              {/* Left Side: interactive Chart */}
              <div className="lg:col-span-8 p-6 space-y-4 border-r border-slate-200 relative">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono">Operational Metrics Curve</h4>
                    <h3 className="text-sm font-extrabold text-slate-800 text-left">
                      分店 7 日滚动营业实收折线图 (ECharts Engine Simulator)
                    </h3>
                  </div>
                  
                  <div className="flex items-center gap-3 text-[10px] font-bold text-gray-500 shrink-0">
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-1 bg-[#48a1a1]" style={{ borderRadius: 0 }}></span> 
                      营业收入 (USD)
                    </span>
                    <span className="font-mono bg-slate-50 border border-slate-200 px-2 py-0.5 uppercase select-none" style={{ borderRadius: 0 }}>
                      Last 7 Days
                    </span>
                  </div>
                </div>

                {/* SVG Graph */}
                <div className="h-64 border border-slate-200 p-2 relative bg-slate-50/50 flex items-center justify-center" style={{ borderRadius: 0 }}>
                  {chartLoading ? (
                    <div className="absolute inset-0 bg-white/80 z-20 flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-2 border-t-transparent border-[#48a1a1] animate-spin" style={{ borderRadius: 0 }}></div>
                      <span className="text-[10px] font-bold text-[#48a1a1] uppercase tracking-wider font-mono">Reloading branch data streams...</span>
                    </div>
                  ) : (
                    <svg className="w-full h-full animate-in fade-in duration-300" viewBox="0 0 540 240">
                      <line x1="40" y1="40" x2="520" y2="40" stroke="#f1f5f9" strokeWidth="1.5" />
                      <line x1="40" y1="100" x2="520" y2="100" stroke="#f1f5f9" strokeWidth="1.5" />
                      <line x1="40" y1="160" x2="520" y2="160" stroke="#f1f5f9" strokeWidth="1.5" />
                      <line x1="40" y1="220" x2="520" y2="220" stroke="#cbd5e1" strokeWidth="1" />
                      <line x1="40" y1="40" x2="40" y2="220" stroke="#cbd5e1" strokeWidth="1" />

                      <text x="32" y="44" className="text-[9px] fill-gray-400 font-mono font-bold text-right font-semibold" textAnchor="end">150 %</text>
                      <text x="32" y="104" className="text-[9px] fill-gray-400 font-mono font-bold text-right font-semibold" textAnchor="end">100 %</text>
                      <text x="32" y="164" className="text-[9px] fill-gray-400 font-mono font-bold text-right font-semibold" textAnchor="end">50 %</text>
                      <text x="32" y="224" className="text-[9px] fill-gray-400 font-mono font-bold text-right font-semibold" textAnchor="end">0</text>

                      <defs>
                        <linearGradient id="reactChartGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#48a1a1" stopOpacity="0.32" />
                          <stop offset="100%" stopColor="#48a1a1" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      
                      <path d={getGradientPath(currentBranch.chartData)} fill="url(#reactChartGrad)" />
                      <path d={getCurvePath(currentBranch.chartData)} fill="none" stroke="#48a1a1" strokeWidth="2.5" />

                      {getChartPoints(currentBranch.chartData).map((val, idx) => (
                        <g key={idx}>
                          <circle 
                            cx={val.x} 
                            cy={val.y} 
                            r="4" 
                            fill="#ffffff" 
                            stroke="#48a1a1" 
                            strokeWidth="2.5" 
                            className="cursor-pointer transition-all duration-150 hover:r-6"
                            onMouseEnter={() => setActivePointIdx(idx)}
                            onMouseLeave={() => setActivePointIdx(null)}
                          />
                          {activePointIdx === idx && (
                            <text 
                              x={val.x} 
                              y={val.y - 10} 
                              className="text-[9px] font-bold fill-slate-900 font-mono" 
                              textAnchor="middle"
                            >
                              {val.value}%
                            </text>
                          )}
                        </g>
                      ))}

                      {['5/30', '5/31', '6/01', '6/02', '6/03', '6/04', '今日'].map((day, idx) => (
                        <text 
                          key={idx}
                          x={40 + idx * 80} 
                          y={235} 
                          className="text-[9px] fill-gray-500 font-mono font-bold" 
                          textAnchor="middle"
                        >
                          {day}
                        </text>
                      ))}
                    </svg>
                  )}
                </div>

                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 p-3 text-[11px] font-medium text-slate-600 text-left" style={{ borderRadius: 0 }}>
                  <span className="text-teal-600 shrink-0 font-bold">💡 分析研判:</span>
                  <span>由于本统计区间内的理疗热度呈季节性攀升，{currentBranch.name} 的主轴业务正趋于全负荷状态。建议协调理疗师休假，避免承接负荷失序导致口碑下滑。</span>
                </div>
              </div>

              {/* Right Side: stats summary cards */}
              <div className="lg:col-span-4 p-6 bg-slate-50/50 space-y-4">
                <div className="border-b border-slate-200 pb-2 text-left">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono">Performance Key indicators</h4>
                  <h3 className="text-sm font-black text-slate-900">核心维度实况概览</h3>
                </div>

                <div className="space-y-4 text-left">
                  {/* Revenue */}
                  <div className="bg-white border-2 border-slate-900 p-4 flex flex-col space-y-1" style={{ borderRadius: 0 }}>
                    <span className="text-[10px] font-black text-[#48a1a1] uppercase tracking-wider font-mono">今日营业收入 (USD)</span>
                    <div className="flex items-baseline gap-1 pt-1">
                      <span className="text-xs text-slate-400 font-bold font-sans">$</span>
                      <span className="text-xl font-black text-slate-900 font-mono select-all">{currentBranch.revenue}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 font-semibold flex items-center gap-1 select-none">
                      <span className="text-emerald-500 font-bold">↑ +14.2%</span>相比于昨日同一节点
                    </div>
                  </div>

                  {/* Orders */}
                  <div className="bg-white border-2 border-slate-900 p-4 flex flex-col space-y-1" style={{ borderRadius: 0 }}>
                    <span className="text-[10px] font-black text-[#48a1a1] uppercase tracking-wider font-mono">今日履约单量 (Today Appointments)</span>
                    <div className="flex items-baseline gap-1 pt-1">
                      <span className="text-xl font-black text-slate-900 font-mono select-all">{currentBranch.orders}</span>
                      <span className="text-xs text-slate-400 font-bold">单</span>
                    </div>
                    <div className="text-[10px] text-gray-400 font-semibold flex items-center gap-1 select-none">
                      <span className="text-emerald-500 font-bold">● 100% 接单率</span> 零延误履约中
                    </div>
                  </div>

                  {/* Techs */}
                  <div className="bg-white border-2 border-slate-900 p-4 flex flex-col space-y-1" style={{ borderRadius: 0 }}>
                    <span className="text-[10px] font-black text-[#48a1a1] uppercase tracking-wider font-mono">今日在岗技师 (Active Specialists)</span>
                    <div className="flex items-baseline gap-1 pt-1">
                      <span className="text-xl font-black text-slate-900 font-mono select-all">{currentBranch.techs}</span>
                      <span className="text-xs text-slate-400 font-bold">位理疗师</span>
                    </div>
                    <div className="text-[10px] text-gray-400 font-semibold flex items-center gap-1 select-none">
                      <span className="inline-block w-2 bg-emerald-500 mx-0.5" style={{ width: '8px', height: '8px', borderRadius: 0 }}></span> 均已在班、轮换休息状态
                    </div>
                  </div>

                  {/* Score */}
                  <div className="bg-white border-2 border-slate-900 p-4 flex flex-col space-y-1" style={{ borderRadius: 0 }}>
                    <span className="text-[10px] font-black text-[#48a1a1] uppercase tracking-wider font-mono">顾客综合评分星级</span>
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xl font-black text-amber-500 font-mono select-all">★ {currentBranch.rating}</span>
                      <span className="text-xs text-slate-400 font-bold">分</span>
                    </div>
                    <div className="text-[10px] text-[#48a1a1] font-bold flex items-center gap-1 select-none">
                      根据近 60 天的 2,400+ 好评反馈自动测算
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="bg-slate-50 px-6 py-4 flex items-center justify-between" style={{ borderRadius: 0 }}>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 font-semibold">
                <span>当前分店环境：</span>
                <span className="text-[#48a1a1] font-mono font-bold">[{currentBranch.code}] / {currentBranch.name}</span>
              </div>
              
              <div className="flex items-center gap-2">
                <button 
                  type="button" 
                  onClick={() => {
                    setShowStatsDialog(false);
                    setActiveEnterStore(null);
                  }}
                  className="text-xs font-black border-2 border-slate-900 bg-white hover:bg-red-50 hover:text-red-600 hover:border-red-600 text-slate-900 px-6 py-2.5 transition-all cursor-pointer"
                  style={{ borderRadius: 0 }}
                >
                  退出附身管理员模式
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

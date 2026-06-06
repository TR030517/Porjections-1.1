export type ViewId = 
  | 'dashboard' 
  | 'area-management' 
  | 'coupon-management' 
  | 'gift-card-management' 
  | 'user-list' 
  | 'post-sales' 
  | 'store-application' 
  | 'store-list' 
  | 'service-orders' 
  | 'gift-card-orders' 
  | 'withdrawal-list' 
  | 'platform-settings' 
  | 'help-list'
  | 'admin-list'
  | 'merchant-list'
  | 'role-management'
  | 'package-management';

export interface NavItem {
  id: ViewId;
  label: string;
  icon: string;
  children?: { id: ViewId; label: string }[];
}

export interface StatCard {
  label: string;
  value: string | number;
}

export interface User {
  id: number;
  avatar: string;
  username: string;
  email: string;
  status: 'active' | 'inactive';
  regDate: string;
}

export interface Coupon {
  id: number;
  name: string;
  amount: number;
  threshold: number;
  validity: string;
  status: 'active' | 'inactive';
  updateDate: string;
}

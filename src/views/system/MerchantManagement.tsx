import React from 'react';
import OperationalPage from '../../components/OperationalPage';
import { operations } from '../../config/operations';
export default function MerchantManagement() { return <OperationalPage config={operations['merchant-list']} />; }
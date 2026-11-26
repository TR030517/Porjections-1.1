import React from 'react';
import OperationalPage from '../../components/OperationalPage';
import { operations } from '../../config/operations';
export default function AdminManagement() { return <OperationalPage config={operations['admin-list']} />; }
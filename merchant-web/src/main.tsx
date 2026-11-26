import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import './global.css';

dayjs.locale('zh-cn');
const router = createBrowserRouter([{ path: '*', element: <App /> }], { basename: '/merchant' });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
      <ConfigProvider
        locale={zhCN}
        theme={{
          token: {
            colorPrimary: '#52c41a',
            colorInfo: '#1890ff',
            colorBgLayout: '#f0f2f5',
            colorBorder: '#d9d9d9',
            colorText: '#262626',
            colorTextSecondary: '#595959',
            borderRadius: 8,
            fontSize: 14,
            controlHeight: 32,
          },
        }}
      >
        <RouterProvider router={router} />
      </ConfigProvider>
  </React.StrictMode>,
);

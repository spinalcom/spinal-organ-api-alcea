/*
 * Copyright 2021 SpinalCom - www.spinalcom.com
 *
 * This file is part of SpinalCore.
 *
 * Please read all of the following terms and conditions
 * of the Free Software license Agreement ("Agreement")
 * carefully.
 *
 * This Agreement is a legally binding contract between
 * the Licensee (as defined below) and SpinalCom that
 * sets forth the terms and conditions that govern your
 * use of the Program. By installing and/or using the
 * Program, you agree to abide by all the terms and
 * conditions stated or referenced herein.
 *
 * If you do not agree to abide by these terms and
 * conditions, do not demonstrate your acceptance and do
 * not install or use the Program.
 * You should have received a copy of the license along
 * with this file. If not, see
 * <http://resources.spinalcom.com/licenses.pdf>.
 */

import { ConcurrencyManager } from 'axios-concurrency';
import axios, { AxiosInstance } from 'axios';
const MAX_CONCURRENT_REQUESTS = 2;

let axiosInstance: AxiosInstance;
let manager;
function newInstance(baseURL: string) {
  if (axiosInstance) {
    detachInstance();
  }
  const base64Credentials = btoa(
    `${process.env.API_USERNAME}:${process.env.API_PASSWORD}`)
  axiosInstance = axios.create({
    baseURL,
    method: 'get',
    headers: { 
      'Content-Type': 'application/json',
      'X-API-KEY': process.env.API_KEY,
      'Authorization': `Basic ${base64Credentials}` , 
    }
  });
  manager = ConcurrencyManager(axiosInstance, MAX_CONCURRENT_REQUESTS);
}

function detachInstance() {
  if (axiosInstance) {
    manager.detach();
    axiosInstance = null;
  }
}

newInstance(process.env.API_SERVER_BASE_URL);
export default axiosInstance;
export { axiosInstance };
export { newInstance };
export { detachInstance };

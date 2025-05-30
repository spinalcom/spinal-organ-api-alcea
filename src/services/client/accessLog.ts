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

// // tslint:disable:max-line-length
// // DIConsulte : Consulte une liste de demande d'interventions.

//import { axiosInstance } from '../../utils/axiosInstance';
import { AxiosInstance } from 'axios';
import { axiosInstance } from '../../utils/axiosInstance';

export interface AlceaLogAccess {
  __type: string;
  AccessID: number;
  AlarmCode: string;
  CompanyName: string;
  DateTime1: string;
  DateTime2: string;
  DepartementName: string;
  DeviceName: string;
  Divers1: string;
  Divers2: string;
  Divers3: string;
  Divers4: string;
  Divers5: string;
  Divers6: string;
  FirstName: string;
  IdentifierInfo: string;
  IdentifierName: string;
  LastName: string;
  Matricule: string;
  PointName: string;
  ServiceName: string;
  SupervisorCode: string;
  AlarmCodeMessage: string;
}

export interface OperationResult {
  Status: string;
  Message: string | null;
  SystemMessage: string | null;
  StackTrace: string | null;
}

export interface AlceaLogAccessParsed extends AlceaLogAccess {
  parsedDateTime1: Date | null;
  parsedDateTime2: Date | null;
}
export interface LogAccessApiResponse {
  CollectionsContainer: AlceaLogAccess[][];
  PageNumber: number;
  PageSize: number;
  ProcessingTime: string;
  TotalNumber: number;
  TotalNumberRequest: number;
  success: boolean;
  OperationResult: OperationResult;
}

export interface LogAccessApiParsedResponse extends Omit<LogAccessApiResponse, 'CollectionsContainer'> {
  CollectionsContainer: AlceaLogAccessParsed[][];
}

export async function getAccessLogs(): Promise<LogAccessApiParsedResponse> {
  const res = await axiosInstance.get<LogAccessApiResponse>(
    `/AlwinService/AlwinServices.svc/web/getlogaccess?format=json&pageNumber=1&pageSize=100&sortByExpression=datetime1 desc`
  );

  const parsedContainer = res.data.CollectionsContainer.map(group =>
    group.map(transformLogAccess)
  );

  return {
    ...res.data,
    CollectionsContainer: parsedContainer,
  };
}

function transformLogAccess(log: AlceaLogAccess): AlceaLogAccessParsed {
  return {
    ...log,
    parsedDateTime1: parseDotNetDate(log.DateTime1),
    parsedDateTime2: parseDotNetDate(log.DateTime2),
  };
}

function parseDotNetDate(dateString: string): Date | null {
  const match = /\/Date\((\d+)([+-]\d{4})?\)\//.exec(dateString);
  return match ? new Date(parseInt(match[1], 10)) : null;
}

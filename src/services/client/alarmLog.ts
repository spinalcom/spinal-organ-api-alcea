import { axiosInstance } from '../../utils/axiosInstance';


export interface AlceaLogAlarm {
    __type: string;
    AlarmID: number;
    AlarmCode: string;
    DateTime1: string;
    DateTime2: string;
    DateTime3: string;
    DateTime4: string;
    DeviceName: string;
    PointName: string;
    SupervisorCode: string;
    AlarmCodeMessage: string;
}

export interface OperationResult {
    Status: string;
    Message: string | null;
    SystemMessage: string | null;
    StackTrace: string | null;
}


export interface AlceaLogAlarmParsed extends AlceaLogAlarm {
  parsedDateTime1: Date | null;
  parsedDateTime2: Date | null;
  parsedDateTime3: Date | null;
  parsedDateTime4: Date | null;
}

export interface LogAlarmApiResponse {
  CollectionsContainer: AlceaLogAlarm[][];
  PageNumber: number;
  PageSize: number;
  ProcessingTime: string;
  TotalNumber: number;
  TotalNumberRequest: number;
  success: boolean;
  OperationResult: OperationResult;
}

export interface LogAlarmApiParsedResponse extends Omit<LogAlarmApiResponse, 'CollectionsContainer'> {
  CollectionsContainer: AlceaLogAlarmParsed[][];
}


export async function getAlarmLogs(): Promise<LogAlarmApiParsedResponse> {
  const res = await axiosInstance.get<LogAlarmApiResponse>(
    `/AlwinService/AlwinServices.svc/web/getlogalarm?format=json&pageNumber=1&pageSize=100&sortByExpression=datetime1 desc`
  );

  const parsedContainer = res.data.CollectionsContainer.map(group =>
    group.map(transformLogAccess)
  );

  return {
    ...res.data,
    CollectionsContainer: parsedContainer,
  };
}

function transformLogAccess(log: AlceaLogAlarm): AlceaLogAlarmParsed {
  return {
    ...log,
    parsedDateTime1: parseDotNetDate(log.DateTime1),
    parsedDateTime2: parseDotNetDate(log.DateTime2),
    parsedDateTime3: parseDotNetDate(log.DateTime3),
    parsedDateTime4: parseDotNetDate(log.DateTime4),
  };
}

function parseDotNetDate(dateString: string): Date | null {
  const match = /\/Date\((\d+)([+-]\d{4})?\)\//.exec(dateString);
  return match ? new Date(parseInt(match[1], 10)) : null;
}
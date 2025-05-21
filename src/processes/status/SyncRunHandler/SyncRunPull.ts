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

import moment = require('moment');

import {
  SpinalContext,
  SpinalGraph,
  SpinalGraphService,
  SpinalNode,
  SpinalNodeRef,
  SPINAL_RELATION_PTR_LST_TYPE,
} from 'spinal-env-viewer-graph-service';
import type OrganConfigModel from '../../../model/OrganConfigModel';
import {
  AlceaLogAccess,
  LogAccessApiResponse,
  AlceaLogAccessParsed,
  getAccessLogs,
} from '../../../services/client/DIConsulte';
import { attributeService } from 'spinal-env-viewer-plugin-documentation-service';
import { NetworkService, SpinalBmsEndpoint } from 'spinal-model-bmsnetwork';
import {
  InputDataDevice,
  InputDataEndpoint,
  InputDataEndpointGroup,
  InputDataEndpointDataType,
  InputDataEndpointType,
} from '../../../model/InputData/InputDataModel/InputDataModel';
import { SpinalServiceTimeseries } from 'spinal-model-timeseries';
import { spinalServiceTicket } from 'spinal-service-ticket';
import axios, { AxiosError } from 'axios';
/**
 * Main purpose of this class is to pull tickets from client.
 *
 * @export
 * @class SyncRunPull
 */
export class SyncRunPull {
  graph: SpinalGraph<any>;
  config: OrganConfigModel;
  interval: number;
  running: boolean;
  nwService: NetworkService;
  networkContext: SpinalNode<any>;
  virtualNetworkContext: SpinalNode<any>;
  timeseriesService: SpinalServiceTimeseries;
  mappingElevators: Map<string, string>;

  constructor(
    graph: SpinalGraph<any>,
    config: OrganConfigModel,
    nwService: NetworkService
  ) {
    this.graph = graph;
    this.config = config;
    this.running = false;
    this.nwService = nwService;
    this.timeseriesService = new SpinalServiceTimeseries();
  }

  async getNetworkContext(): Promise<SpinalNode<any>> {
    const contexts = await this.graph.getChildren();
    for (const context of contexts) {
      if (context.info.name.get() === process.env.NETWORK_CONTEXT_NAME) {
        // @ts-ignore
        SpinalGraphService._addNode(context);
        return context;
      }
    }
    throw new Error('Network Context Not found');
  }

  async getTicketContext(): Promise<SpinalNode<any>> {
    const contexts = await this.graph.getChildren();
    for (const context of contexts) {
      if (context.info.name.get() === process.env.TICKET_CONTEXT_NAME) {
        // @ts-ignore
        SpinalGraphService._addNode(context);
        return context;
      }
    }
    throw new Error('Ticket Context Not found');
  }

  async getTicketProcess(): Promise<SpinalNode<any>> {
    const context = await this.getTicketContext();
    const processes = await context.getChildren(
      'SpinalSystemServiceTicketHasProcess'
    );
    const ticketProcess = processes.find((proc) => {
      // @ts-ignore
      SpinalGraphService._addNode(proc);
      return proc.getName().get() === process.env.TICKET_PROCESS_NAME;
    });
    if (!ticketProcess) {
      throw new Error('Ticket Process Not found');
    }
    return ticketProcess;
  }

  async getVirtualNetwork(): Promise<SpinalNode<any>> {
    const context = await this.getNetworkContext();
    const virtualNetworks = await context.getChildren('hasBmsNetwork');
    return virtualNetworks.find((network) => {
      return network.getName().get() === process.env.VIRTUAL_NETWORK_NAME;
    });
  }

  async initNetworkNodes(): Promise<void> {
    const context = await this.getNetworkContext();
    const virtualNetwork = await this.getVirtualNetwork();
    this.networkContext = context;
    this.virtualNetworkContext = virtualNetwork;
  }

  private waitFct(nb: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(
        () => {
          resolve();
        },
        nb >= 0 ? nb : 0
      );
    });
  }

  /*async pullAndUpdateTickets(): Promise<void> {
    
    const context = await this.getTicketContext();
    const process = await this.getTicketProcess();


    const steps: SpinalNodeRef[] =
      await spinalServiceTicket.getStepsFromProcess(
        process.getId().get(),
        context.getId().get()
      );

    const raisedStep = steps.find((step) => {
      return step.name.get() === 'Raised';
    });

    const solvedStep = steps.find((step) => {
      return step.name.get() === 'Solved';
    })


    const raisedTickets = await spinalServiceTicket.getTicketsFromStep(
      raisedStep.id.get()
    );
    const solvedTickets = await spinalServiceTicket.getTicketsFromStep(
      solvedStep.id.get()
    );


    console.log('Current Raised Tickets:', raisedTickets.length);
    console.log('Current Solved Tickets:', solvedTickets.length);


    

    const notificationData = await getNotifications(); // Updated to fetch notifications
    console.log('Fetched notifications:', notificationData);

    for(const notification of notificationData.data) {
      const ticketInfo = {
        name : `${notification.type}-${notification.entity.asset.id}`,
        date: notification.date,
        client_name: notification.client_name,
        entity_class: notification.entity_class,
      };
      console.log('Ticket:', ticketInfo);
      


      if(!raisedTickets.find((ticket) => ticket.name.get() === ticketInfo.name)) {
        console.log('Creating ticket ...');
        const ticketNode = await spinalServiceTicket.addTicket(
          ticketInfo,
          process.getId().get(),
          context.getId().get(),
          "SpinalNode-0ba1d49d-826d-73e1-0e77-d6d8b187e357-186df7cd2a2",
          'alarm'
        );
        console.log('Ticket created:', ticketNode);
      } else {
        console.log('Ticket already exists:', ticketInfo.name);
        continue;
      }
    }

    for(const ticket of raisedTickets){
      if(!notificationData.data.find((notification) => 
        notification.type === ticket.name.get().split('-')[0] 
      && notification.entity.asset.id === parseInt(ticket.id.get().split('-')[1]))){
        console.log('Update step of ticket:', ticket.name.get());
        await spinalServiceTicket.moveTicketToNextStep(
          context.getId().get(),
          process.getId().get(),
          ticket.id.get(),
        );
      }
    }
    
  }*/

  dateToNumber(dateString: string | Date) {
    const dateObj = new Date(dateString);
    return dateObj.getTime();
  }

  async addAttributesToDevice(
    node: SpinalNode<any>,
    accessLog: AlceaLogAccess
  ) {
    await attributeService.addAttributeByCategoryName(
      node,
      'Alcea',
      'DeviceName',
      accessLog.DeviceName
    );
    await attributeService.addAttributeByCategoryName(
      node,
      'Alcea',
      'AlarmCode',
      accessLog.AlarmCode
    );
    console.log('Attributes added to device ', accessLog.PointName);
  }

  async createEndpoint(deviceId: string, name: string) {
    const context = await this.getNetworkContext();
    const endpointNodeModel = new InputDataEndpoint(
      `${name}`,
      0,
      '',
      InputDataEndpointDataType.Integer,
      InputDataEndpointType.Other
    );

    const res = new SpinalBmsEndpoint(
      endpointNodeModel.name,
      endpointNodeModel.path,
      endpointNodeModel.currentValue,
      endpointNodeModel.unit,
      InputDataEndpointDataType[endpointNodeModel.dataType],
      InputDataEndpointType[endpointNodeModel.type],
      endpointNodeModel.id
    );
    const childId = SpinalGraphService.createNode(
      { type: SpinalBmsEndpoint.nodeTypeName, name: endpointNodeModel.name },
      res
    );
    await SpinalGraphService.addChildInContext(
      deviceId,
      childId,
      context.getId().get(),
      SpinalBmsEndpoint.relationName,
      SPINAL_RELATION_PTR_LST_TYPE
    );

    const node = SpinalGraphService.getRealNode(childId);
    //await this.addEndpointAttributes(node,measure);
    return node;
  }

  async createDevice(deviceName) {
    const deviceNodeModel = new InputDataDevice(deviceName, 'device');
    //await this.nwService.updateData(deviceNodeModel);
    const device = await this.nwService.createNewBmsDevice(
      this.virtualNetworkContext.getId().get(),
      deviceNodeModel
    );
    console.log('Created device ', device.name.get());
    return device;
  }

  async updateAccessLogsData(logAccessDatas: AlceaLogAccessParsed[]) {
    for (const logAccess of logAccessDatas) {
      let deviceNodes: SpinalNode<any>[] =
        await this.virtualNetworkContext.getChildren('hasBmsDevice');
      // console.log('Log Access : ', logAccess.PointName);
      let deviceNode = deviceNodes.find(
        (deviceNode) => deviceNode.getName().get() === logAccess.PointName
      );
      if (!deviceNode) {
        const deviceInfo = await this.createDevice(logAccess.PointName);
        deviceNode = SpinalGraphService.getRealNode(deviceInfo.id.get());
        await this.createEndpoint(deviceNode.getId().get(), 'In');
        await this.createEndpoint(deviceNode.getId().get(), 'Out');
        await this.addAttributesToDevice(deviceNode, logAccess);
      }

      SpinalGraphService._addNode(deviceNode);

      // Look for endpoints

      const endpoints = await deviceNode.getChildren('hasBmsEndpoint');
      let endpointNodeIn = endpoints.find(
        (endpoint) => endpoint.getName().get() === 'In'
      );
      let endpointNodeOut = endpoints.find(
        (endpoint) => endpoint.getName().get() === 'Out'
      );
      if (!endpointNodeIn || !endpointNodeOut) {
        console.error('Endpoint In or Out not found');
        return;
      }
      SpinalGraphService._addNode(endpointNodeIn);
      SpinalGraphService._addNode(endpointNodeOut);

      const inElement = await endpointNodeIn.element.load();
      const outElement = await endpointNodeOut.element.load();
      const currentValueIn = inElement.currentValue.get();
      const currentValueOut = outElement.currentValue.get();

      if (logAccess.AlarmCodeMessage == 'Ouverture porte : bouton poussoir') {
        // increment Out
        // await this.nwService.setEndpointValue(
        //   endpointNodeOut.info.id.get(),
        //   currentValueOut + 1
        // );
        outElement.currentValue.set(currentValueOut + 1);
        await this.timeseriesService.insertFromEndpoint(
          endpointNodeOut.info.id.get(),
          currentValueOut + 1,
          logAccess.parsedDateTime1
        );
        console.log(
          'Incremented Out value from ', currentValueOut,
          'to', currentValueOut + 1,
          'for device',
          logAccess.PointName
        );
      } else if (logAccess.AlarmCodeMessage == 'Badge accepté') {
        // increment In
        // await this.nwService.setEndpointValue(
        //   endpointNodeIn.info.id.get(),
        //   currentValueIn + 1
        // );
        inElement.currentValue.set(currentValueIn + 1);
        await this.timeseriesService.insertFromEndpoint(
          endpointNodeIn.info.id.get(),
          currentValueIn + 1,
          logAccess.parsedDateTime1
        );
        console.log(
          'Incremented In value from ', currentValueIn,
          'to', currentValueIn + 1,
          'for device',
          logAccess.PointName
        );
      }
    }
  }

  async doNetworkJob() {
    console.log('Getting asset information...');
    const startTime = Date.now();
    const accessLogs = await getAccessLogs();
    // console.log('Most Recent Log :', accessLogs.CollectionsContainer[0][0]);
    const fetchTime = (Date.now() - startTime) / 1000;
    console.log(`Access logs received in ${fetchTime} seconds`);

    const lastSyncTime = this.config.lastSync.get(); // epoch millis


    // Filter out previously synced logs
    const newLogs = accessLogs.CollectionsContainer[0].filter((log) => {
      return (
        log.parsedDateTime1 && log.parsedDateTime1.getTime() > lastSyncTime

      );
    }).reverse();
    console.log(
      `After filter : Kept ${newLogs.length} logs out of ${accessLogs.CollectionsContainer[0].length} total`
    );

    console.log('Updating data ...');
    const updateStartTime = Date.now();
    await this.updateAccessLogsData(newLogs); // Update to use newLogs
    const updateTime = (Date.now() - updateStartTime) / 1000;
    console.log(`Access logs data updated in ${updateTime} seconds`);
  }

  async resetEndpointValuesIfNeeded() {
    if (this.config.lastSync.get() === 0) return;
    const lastSyncDate = moment(this.config.lastSync.get());
    const today = moment();
    if (lastSyncDate.isSame(today, 'day')) {
      return;
    }
    console.log('Resetting endpoint values to 0');
    const deviceNodes: SpinalNode<any>[] =
      await this.virtualNetworkContext.getChildren('hasBmsDevice');
    for (const deviceNode of deviceNodes) {
      const endpoints = await deviceNode.getChildren('hasBmsEndpoint');
      for (const endpoint of endpoints) {
        SpinalGraphService._addNode(endpoint);
        await this.nwService.setEndpointValue(endpoint.info.id.get(), 0);
      }
    }
    console.log('Endpoint values reset to 0 successfully');
  }

  async init(): Promise<void> {
    console.log('Initiating SyncRunPull');
    try {
      await this.initNetworkNodes();
      await this.resetEndpointValuesIfNeeded();
      await this.doNetworkJob();

      this.config.lastSync.set(Date.now());
    } catch (e) {
      console.error(e);
    }
  }

  async run(): Promise<void> {
    this.running = true;
    const timeout = parseInt(process.env.PULL_INTERVAL);
    await this.waitFct(timeout);
    while (true) {
      if (!this.running) break;
      const before = Date.now();
      try {
        await this.resetEndpointValuesIfNeeded();
        await this.doNetworkJob();
        this.config.lastSync.set(Date.now());
      } catch (e) {
        axios.isAxiosError(e) ? console.error('[AxiosError]') : console.error('erreur non axios');
        await this.waitFct(1000 * 60);
      } finally {
        const delta = Date.now() - before;
        const timeout = parseInt(process.env.PULL_INTERVAL) - delta;
        await this.waitFct(timeout);
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}
export default SyncRunPull;

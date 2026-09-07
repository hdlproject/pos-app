--
-- PostgreSQL database dump
--

\restrict shTCyWFjRivq7ahznxOAsVf0ogn79kbzWhjByIrf5wKbRGoTFMbDUwZoX7TsdRw

-- Dumped from database version 16.14 (Debian 16.14-1.pgdg13+1)
-- Dumped by pg_dump version 16.14 (Debian 16.14-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: ItemStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ItemStatus" AS ENUM (
    'QUEUED',
    'PREPARING',
    'READY',
    'SERVED'
);


--
-- Name: OrderSource; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OrderSource" AS ENUM (
    'STAFF',
    'QR'
);


--
-- Name: OrderStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OrderStatus" AS ENUM (
    'OPEN',
    'SENT_TO_KITCHEN',
    'READY',
    'SERVED',
    'PAID',
    'CANCELLED'
);


--
-- Name: OrderType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OrderType" AS ENUM (
    'DINE_IN',
    'TAKEAWAY',
    'DELIVERY'
);


--
-- Name: Role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Role" AS ENUM (
    'ADMIN',
    'STAFF',
    'KITCHEN'
);


--
-- Name: StockBatchStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."StockBatchStatus" AS ENUM (
    'PENDING',
    'CONFIRMED',
    'CANCELLED'
);


--
-- Name: StockReason; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."StockReason" AS ENUM (
    'SALE',
    'MANUAL_ADJUST',
    'RESTOCK',
    'VOID_REVERT'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Category" (
    id text NOT NULL,
    name text NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL
);


--
-- Name: Ingredient; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Ingredient" (
    id text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    "stockQty" numeric(10,3) NOT NULL
);


--
-- Name: MenuItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MenuItem" (
    id text NOT NULL,
    name text NOT NULL,
    price numeric(10,2) NOT NULL,
    "categoryId" text NOT NULL,
    available boolean DEFAULT true NOT NULL,
    image text,
    modifiers jsonb,
    "outOfStockReason" text,
    description text,
    instructions text
);


--
-- Name: Order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Order" (
    id text NOT NULL,
    type public."OrderType" NOT NULL,
    "tableId" text,
    status public."OrderStatus" DEFAULT 'OPEN'::public."OrderStatus" NOT NULL,
    source public."OrderSource" NOT NULL,
    "createdById" text,
    total numeric(10,2) DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "cancelReason" text,
    "isOpenTableSession" boolean DEFAULT false NOT NULL,
    "parentOrderId" text,
    "sessionFinished" boolean DEFAULT false NOT NULL
);


--
-- Name: OrderItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OrderItem" (
    id text NOT NULL,
    "orderId" text NOT NULL,
    "menuItemId" text NOT NULL,
    qty integer NOT NULL,
    modifiers jsonb,
    "unitPrice" numeric(10,2) NOT NULL,
    "kitchenStatus" public."ItemStatus" DEFAULT 'QUEUED'::public."ItemStatus" NOT NULL
);


--
-- Name: Payment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Payment" (
    id text NOT NULL,
    "orderId" text NOT NULL,
    amount numeric(10,2) NOT NULL,
    method text DEFAULT 'CASH'::text NOT NULL,
    "receivedById" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Recipe; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Recipe" (
    id text NOT NULL,
    "menuItemId" text NOT NULL,
    "ingredientId" text NOT NULL,
    "qtyPerUnit" numeric(10,3) NOT NULL
);


--
-- Name: StockAdjustmentBatch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."StockAdjustmentBatch" (
    id text NOT NULL,
    status public."StockBatchStatus" DEFAULT 'PENDING'::public."StockBatchStatus" NOT NULL,
    note text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdById" text NOT NULL,
    "confirmedAt" timestamp(3) without time zone,
    "confirmedById" text
);


--
-- Name: StockAdjustmentLine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."StockAdjustmentLine" (
    id text NOT NULL,
    "batchId" text NOT NULL,
    "ingredientId" text NOT NULL,
    delta numeric(10,3) NOT NULL,
    reason public."StockReason" NOT NULL
);


--
-- Name: StockMovement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."StockMovement" (
    id text NOT NULL,
    "ingredientId" text NOT NULL,
    delta numeric(10,3) NOT NULL,
    reason public."StockReason" NOT NULL,
    "refOrderId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdById" text NOT NULL
);


--
-- Name: Store; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Store" (
    id text NOT NULL,
    name text NOT NULL
);


--
-- Name: Table; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Table" (
    id text NOT NULL,
    label text NOT NULL,
    "qrToken" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    id text NOT NULL,
    name text NOT NULL,
    "pinHash" text NOT NULL,
    role public."Role" NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Category Category_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Category"
    ADD CONSTRAINT "Category_pkey" PRIMARY KEY (id);


--
-- Name: Ingredient Ingredient_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Ingredient"
    ADD CONSTRAINT "Ingredient_pkey" PRIMARY KEY (id);


--
-- Name: MenuItem MenuItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MenuItem"
    ADD CONSTRAINT "MenuItem_pkey" PRIMARY KEY (id);


--
-- Name: OrderItem OrderItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OrderItem"
    ADD CONSTRAINT "OrderItem_pkey" PRIMARY KEY (id);


--
-- Name: Order Order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Order"
    ADD CONSTRAINT "Order_pkey" PRIMARY KEY (id);


--
-- Name: Payment Payment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_pkey" PRIMARY KEY (id);


--
-- Name: Recipe Recipe_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Recipe"
    ADD CONSTRAINT "Recipe_pkey" PRIMARY KEY (id);


--
-- Name: StockAdjustmentBatch StockAdjustmentBatch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StockAdjustmentBatch"
    ADD CONSTRAINT "StockAdjustmentBatch_pkey" PRIMARY KEY (id);


--
-- Name: StockAdjustmentLine StockAdjustmentLine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StockAdjustmentLine"
    ADD CONSTRAINT "StockAdjustmentLine_pkey" PRIMARY KEY (id);


--
-- Name: StockMovement StockMovement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StockMovement"
    ADD CONSTRAINT "StockMovement_pkey" PRIMARY KEY (id);


--
-- Name: Store Store_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Store"
    ADD CONSTRAINT "Store_pkey" PRIMARY KEY (id);


--
-- Name: Table Table_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Table"
    ADD CONSTRAINT "Table_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: Recipe_menuItemId_ingredientId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Recipe_menuItemId_ingredientId_key" ON public."Recipe" USING btree ("menuItemId", "ingredientId");


--
-- Name: StockAdjustmentLine_batchId_ingredientId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "StockAdjustmentLine_batchId_ingredientId_key" ON public."StockAdjustmentLine" USING btree ("batchId", "ingredientId");


--
-- Name: Table_label_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Table_label_key" ON public."Table" USING btree (label);


--
-- Name: Table_qrToken_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Table_qrToken_key" ON public."Table" USING btree ("qrToken");


--
-- Name: one_pending_stock_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX one_pending_stock_batch ON public."StockAdjustmentBatch" USING btree (status) WHERE (status = 'PENDING'::public."StockBatchStatus");


--
-- Name: MenuItem MenuItem_categoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MenuItem"
    ADD CONSTRAINT "MenuItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES public."Category"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OrderItem OrderItem_menuItemId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OrderItem"
    ADD CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES public."MenuItem"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OrderItem OrderItem_orderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OrderItem"
    ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES public."Order"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Order Order_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Order"
    ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Order Order_parentOrderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Order"
    ADD CONSTRAINT "Order_parentOrderId_fkey" FOREIGN KEY ("parentOrderId") REFERENCES public."Order"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Order Order_tableId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Order"
    ADD CONSTRAINT "Order_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES public."Table"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Payment Payment_orderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES public."Order"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Payment Payment_receivedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Recipe Recipe_ingredientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Recipe"
    ADD CONSTRAINT "Recipe_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES public."Ingredient"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Recipe Recipe_menuItemId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Recipe"
    ADD CONSTRAINT "Recipe_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES public."MenuItem"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: StockAdjustmentBatch StockAdjustmentBatch_confirmedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StockAdjustmentBatch"
    ADD CONSTRAINT "StockAdjustmentBatch_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: StockAdjustmentBatch StockAdjustmentBatch_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StockAdjustmentBatch"
    ADD CONSTRAINT "StockAdjustmentBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: StockAdjustmentLine StockAdjustmentLine_batchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StockAdjustmentLine"
    ADD CONSTRAINT "StockAdjustmentLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES public."StockAdjustmentBatch"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: StockAdjustmentLine StockAdjustmentLine_ingredientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StockAdjustmentLine"
    ADD CONSTRAINT "StockAdjustmentLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES public."Ingredient"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: StockMovement StockMovement_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StockMovement"
    ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: StockMovement StockMovement_ingredientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StockMovement"
    ADD CONSTRAINT "StockMovement_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES public."Ingredient"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict shTCyWFjRivq7ahznxOAsVf0ogn79kbzWhjByIrf5wKbRGoTFMbDUwZoX7TsdRw


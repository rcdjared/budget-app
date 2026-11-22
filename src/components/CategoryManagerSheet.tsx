import React, { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { X, Plus, Edit2, Trash2, Check, FolderPlus, Sparkles } from "lucide-react";
import { db } from "@/db/schema";
import { profileRecords } from "@/db/profileScope";
import {
  createCategory,
  updateCategory,
  softDeleteCategory,
} from "@/db/repositories/categories";
import type { Category, CategoryType } from "@/domain/types";
import {
  CategoryIcon,
  CATEGORY_ICON_LIST,
  CATEGORY_COLORS,
} from "@/components/CategoryIcon";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, LEGACY_EXPENSE_CATEGORY_NAMES } from "@/db/seed";

interface CategoryManagerSheetProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  defaultType?: CategoryType;
  onSelectCategory?: (categoryId: string) => void;
}

export function CategoryManagerSheet({
  open,
  onClose,
  profileId,
  defaultType = "expense",
  onSelectCategory,
}: CategoryManagerSheetProps) {
  const [activeTab, setActiveTab] = useState<CategoryType>(defaultType);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Form state for add/edit
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<CategoryType>("expense");
  const [formIcon, setFormIcon] = useState("utensils");
  const [formColor, setFormColor] = useState(CATEGORY_COLORS[0]);
  const [formParentId, setFormParentId] = useState<string>("");
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [formError, setFormError] = useState("");

  const categories = useLiveQuery(
    () =>
      profileRecords(db.categories, profileId)
        .filter((c) => !c.deletedAt)
        .sortBy("sortOrder"),
    [profileId],
    []
  );

  useEffect(() => {
    if (open) setActiveTab(defaultType);
  }, [open, defaultType]);

  if (!open) return null;

  const currentTabCategories = (() => {
    const visible = categories.filter((category) =>
      category.type === activeTab && (activeTab === "income" || !LEGACY_EXPENSE_CATEGORY_NAMES.has(category.name))
    );
    const unique = new Map<string, Category>();
    for (const category of visible) {
      const key = category.name.trim().toLowerCase();
      if (!unique.has(key)) unique.set(key, category);
    }
    return [...unique.values()].sort((a, b) => {
      if (activeTab === "income") return a.sortOrder - b.sortOrder;
      const aOrder = EXPENSE_CATEGORIES.findIndex((seed) => seed.name.toLowerCase() === a.name.trim().toLowerCase());
      const bOrder = EXPENSE_CATEGORIES.findIndex((seed) => seed.name.toLowerCase() === b.name.trim().toLowerCase());
      return (aOrder < 0 ? Number.MAX_SAFE_INTEGER : aOrder) - (bOrder < 0 ? Number.MAX_SAFE_INTEGER : bOrder) || a.sortOrder - b.sortOrder;
    });
  })();
  const parentCategories = currentTabCategories.filter((c) => !c.parentId);

  const startAdd = () => {
    setEditingCategory(null);
    setFormName("");
    setFormType(activeTab);
    setFormIcon(activeTab === "income" ? "banknote" : "shopping-bag");
    setFormColor(CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)]);
    setFormParentId("");
    setShowIconPicker(false);
    setFormError("");
    setIsAdding(true);
  };

  const startEdit = (cat: Category) => {
    setEditingCategory(cat);
    setFormName(cat.name);
    setFormType(cat.type);
    setFormIcon(cat.icon || "more-horizontal");
    setFormColor(cat.color || CATEGORY_COLORS[0]);
    setFormParentId(cat.parentId || "");
    setShowIconPicker(false);
    setFormError("");
    setIsAdding(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = formName.trim();
    if (!name) return;
    if (name.length > 20) {
      setFormError("Use 20 characters or fewer.");
      return;
    }
    if (categories.some((category) => category.id !== editingCategory?.id && category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setFormError("A category with this name already exists.");
      return;
    }
    setFormError("");

    if (editingCategory) {
      await updateCategory(editingCategory.id, profileId, {
        name,
        type: formType,
        icon: formIcon,
        color: formColor,
        parentId: formParentId || null,
      });
    } else {
      const newId = await createCategory({
        profileId,
        name: formName.trim(),
        type: formType,
        icon: formIcon,
        color: formColor,
        parentId: formParentId || null,
        sortOrder: categories.length + 1,
      });
      if (onSelectCategory) {
        onSelectCategory(newId);
        onClose();
      }
    }

    document.querySelector<HTMLElement>(".category-manager-sheet")?.removeAttribute("data-sheet-dirty");

    setIsAdding(false);
    setEditingCategory(null);
  };

  const handleDelete = async (cat: Category) => {
    const isParent = categories.some((c) => c.parentId === cat.id);
    const msg = isParent
      ? `Delete "${cat.name}" and its subcategories? Past transactions will keep their history.`
      : `Delete "${cat.name}"? Past transactions will keep their history.`;

    if (window.confirm(msg)) {
      await softDeleteCategory(cat.id, profileId);
      // Also soft-delete any children
      const children = categories.filter((c) => c.parentId === cat.id);
      for (const child of children) {
        await softDeleteCategory(child.id, profileId);
      }
      if (editingCategory?.id === cat.id) {
        setIsAdding(false);
        setEditingCategory(null);
      }
    }
  };

  const handleAddDefaultMissing = async () => {
    const existingNames = new Set(categories.map((c) => c.name.toLowerCase()));
    const seeds = activeTab === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    const timestamp = new Date().toISOString();
    let count = 0;

    for (const seed of seeds) {
      if (!existingNames.has(seed.name.toLowerCase())) {
        const parentId = crypto.randomUUID();
        await db.categories.add({
          id: parentId,
          profileId,
          name: seed.name,
          parentId: null,
          type: seed.type,
          icon: seed.icon,
          color: seed.color,
          sortOrder: categories.length + count,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        count++;

        if (seed.children) {
          for (const child of seed.children) {
            await db.categories.add({
              id: crypto.randomUUID(),
              profileId,
              name: child.name,
              parentId,
              type: seed.type,
              icon: child.icon,
              color: child.color,
              sortOrder: categories.length + count,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            count++;
          }
        }
      }
    }

    alert(`Added ${count} categories from standard templates.`);
  };

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Manage Categories"
    >
      <section className="account-sheet category-manager-sheet">
        <header className="sheet-header">
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <b>Categories</b>
          <button
            className="add-cat-top-btn"
            onClick={startAdd}
            aria-label="Add new category"
            title="Add category"
          >
            <Plus size={20} />
          </button>
        </header>

        {/* Tab switch between Expense and Income */}
        <div className="cat-type-switch">
          <button
            className={activeTab === "expense" ? "active" : ""}
            onClick={() => {
              setActiveTab("expense");
              setIsAdding(false);
            }}
          >
            Expenses ({categories.filter((c) => c.type === "expense").length})
          </button>
          <button
            className={activeTab === "income" ? "active" : ""}
            onClick={() => {
              setActiveTab("income");
              setIsAdding(false);
            }}
          >
            Income ({categories.filter((c) => c.type === "income").length})
          </button>
        </div>

        {/* Form view when Adding or Editing */}
        {isAdding ? (
          <form onSubmit={handleSave} className="category-form">
            <div className="cat-form-header">
              <h3>{editingCategory ? "Edit Category" : "New Category"}</h3>
              {editingCategory && (
                <button
                  type="button"
                  className="cat-delete-btn"
                  onClick={() => handleDelete(editingCategory)}
                  title="Delete category"
                >
                  <Trash2 size={16} /> Delete
                </button>
              )}
            </div>

            <div className="cat-preview-row">
              <CategoryIcon icon={formIcon} color={formColor} size={24} />
              <div className="cat-preview-info">
                <b>{formName || "Category Name"}</b>
                <small>{formType === "expense" ? "Expense category" : "Income category"}</small>
              </div>
            </div>

            <label className="form-field">
              <span>Category Name</span>
              <input
                type="text"
                value={formName}
                onChange={(e) => { setFormName(e.target.value.slice(0, 20)); setFormError(""); }}
                placeholder="e.g. Groceries, Streaming, Coffee"
                maxLength={20}
                required
                autoFocus
              />
            </label>
            {formError && <p className="category-form-error" role="alert">{formError}</p>}

            <div className="form-field">
              <span>Category Icon</span>
              <button
                type="button"
                className="icon-select-trigger"
                onClick={() => setShowIconPicker(!showIconPicker)}
              >
                <CategoryIcon icon={formIcon} color={formColor} size={20} />
                <span>
                  {CATEGORY_ICON_LIST.find((i) => i.id === formIcon)?.name || "Select icon"}
                </span>
                <small>{showIconPicker ? "Hide icons ▲" : "Change icon ▼"}</small>
              </button>

              {showIconPicker && (
                <div className="icon-grid-picker">
                  {CATEGORY_ICON_LIST.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`icon-grid-item ${formIcon === item.id ? "selected" : ""}`}
                      onClick={() => {
                        setFormIcon(item.id);
                        setShowIconPicker(false);
                      }}
                      title={item.name}
                    >
                      <item.Icon size={18} />
                      <span className="icon-grid-label">{item.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="form-field">
              <span>Color</span>
              <div className="color-swatch-picker">
                {CATEGORY_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`color-swatch ${formColor === c ? "selected" : ""}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setFormColor(c)}
                    aria-label={`Select color ${c}`}
                  >
                    {formColor === c && <Check size={14} color="#fff" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>

            <label className="form-field">
              <span>Parent Category (Optional)</span>
              <select
                value={formParentId}
                onChange={(e) => setFormParentId(e.target.value)}
              >
                <option value="">None (Top-level Category)</option>
                {parentCategories
                  .filter((p) => p.id !== editingCategory?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>

            <div className="cat-form-actions">
              <button
                type="button"
                className="cat-cancel-btn"
                onClick={() => {
                  setIsAdding(false);
                  setEditingCategory(null);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="save-button"
                disabled={!formName.trim()}
              >
                {editingCategory ? "Update Category" : "Create Category"}
              </button>
            </div>
          </form>
        ) : (
          /* List view of categories */
          <div className="category-manager-list">
            <div className="cat-list-actions">
              <button
                type="button"
                className="add-cat-inline-btn"
                onClick={startAdd}
              >
                <Plus size={16} /> Add {activeTab} category
              </button>
              <button
                type="button"
                className="template-seed-btn"
                onClick={handleAddDefaultMissing}
                title="Populate missing default categories from templates"
              >
                <Sparkles size={14} /> Add suggested categories
              </button>
            </div>

            {parentCategories.length === 0 ? (
              <div className="empty-cat-message">
                <FolderPlus size={32} />
                <p>No {activeTab} categories found</p>
                <button onClick={startAdd} className="empty-action">
                  Create your first category
                </button>
              </div>
            ) : (
              <div className="cat-group-container">
                {parentCategories.map((parent) => {
                  const children = currentTabCategories.filter(
                    (c) => c.parentId === parent.id
                  );
                  return (
                    <div key={parent.id} className="cat-group-card">
                      <div
                        className="cat-item-row parent-row"
                        onClick={() => {
                          if (onSelectCategory) {
                            onSelectCategory(parent.id);
                            onClose();
                          } else {
                            startEdit(parent);
                          }
                        }}
                      >
                        <CategoryIcon
                          icon={parent.icon}
                          color={parent.color}
                          size={18}
                        />
                        <div className="cat-item-details">
                          <b>{parent.name}</b>
                          {children.length > 0 && (
                            <small>{children.length} subcategories</small>
                          )}
                        </div>
                        <button
                          type="button"
                          className="cat-edit-icon-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(parent);
                          }}
                          aria-label={`Edit ${parent.name}`}
                        >
                          <Edit2 size={16} />
                        </button>
                      </div>

                      {children.length > 0 && (
                        <div className="cat-sub-list">
                          {children.map((child) => (
                            <div
                              key={child.id}
                              className="cat-item-row child-row"
                              onClick={() => {
                                if (onSelectCategory) {
                                  onSelectCategory(child.id);
                                  onClose();
                                } else {
                                  startEdit(child);
                                }
                              }}
                            >
                              <span className="child-tree-connector" />
                              <CategoryIcon
                                icon={child.icon}
                                color={child.color}
                                size={15}
                              />
                              <div className="cat-item-details">
                                <span>{child.name}</span>
                              </div>
                              <button
                                type="button"
                                className="cat-edit-icon-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEdit(child);
                                }}
                                aria-label={`Edit ${child.name}`}
                              >
                                <Edit2 size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
